import { NextRequest } from "next/server";
import { OpenAI } from "openai";

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

// Simple in-memory store for diffs (would use a real database in production)
const diffStore = new Map<string, string>();

export const runtime = "edge";

// Define CORS headers
const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
  "Access-Control-Allow-Headers": "Content-Type, Authorization",
};

// Handle OPTIONS requests (preflight)
export async function OPTIONS() {
  return new Response(null, {
    status: 204,
    headers: corsHeaders,
  });
}

// Route to receive the diff content via POST
export async function POST(request: NextRequest) {
  try {
    console.log("POST request received");
    const body = await request.json();
    const { prId, description, diff } = body;

    if (!prId || !description || !diff) {
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Store the diff for use in streaming
    const sessionId = `${prId}-${Date.now()}`;
    diffStore.set(sessionId, diff);
    console.log(
      `Diff stored with sessionId: ${sessionId}, length: ${diff.length}`
    );

    // Return the sessionId for the client to use in the streaming request
    return new Response(JSON.stringify({ sessionId }), {
      status: 200,
      headers: {
        "Content-Type": "application/json",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("Error in POST handler:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to process request",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}

// Stream the generation results
export async function GET(request: NextRequest) {
  try {
    console.log("GET request received");
    const { searchParams } = new URL(request.url);
    const sessionId = searchParams.get("sessionId");
    const prId = searchParams.get("prId");
    const description = searchParams.get("description");

    if (!sessionId || !prId || !description) {
      console.log("Missing parameters:", { sessionId, prId, description });
      return new Response(
        JSON.stringify({ error: "Missing required parameters" }),
        {
          status: 400,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }

    // Retrieve the diff from storage
    const diff = diffStore.get(sessionId);
    if (!diff) {
      console.log(`Diff not found for sessionId: ${sessionId}`);
      return new Response(
        JSON.stringify({ error: "Diff not found, please try again" }),
        {
          status: 404,
          headers: {
            "Content-Type": "application/json",
            ...corsHeaders,
          },
        }
      );
    }
    console.log(
      `Diff retrieved for sessionId: ${sessionId}, length: ${diff.length}`
    );

    // Set up streaming response
    const encoder = new TextEncoder();
    const stream = new TransformStream();
    const writer = stream.writable.getWriter();

    // Process the generation in the background
    generateNotes(writer, diff, prId, description)
      .catch((error) => {
        console.error("Error generating notes:", error);
        const errorMsg = {
          type: "error",
          error:
            error instanceof Error ? error.message : "Unknown error occurred",
        };
        writer.write(encoder.encode(`data: ${JSON.stringify(errorMsg)}\n\n`));
        writer.close();

        // Clean up storage
        diffStore.delete(sessionId);
      })
      .finally(() => {
        // Clean up storage after streaming completes
        diffStore.delete(sessionId);
      });

    // Return the stream
    return new Response(stream.readable, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
        "X-Accel-Buffering": "no",
        ...corsHeaders,
      },
    });
  } catch (error) {
    console.error("Error in GET handler:", error);
    return new Response(
      JSON.stringify({
        error: "Failed to set up streaming",
        details: error instanceof Error ? error.message : "Unknown error",
      }),
      {
        status: 500,
        headers: {
          "Content-Type": "application/json",
          ...corsHeaders,
        },
      }
    );
  }
}

async function generateNotes(
  writer: WritableStreamDefaultWriter,
  diff: string,
  prId: string,
  description: string
) {
  const encoder = new TextEncoder();

  try {
    // Limit the diff size to prevent token limit issues
    const truncatedDiff =
      diff.length > 15000 ? `${diff.substring(0, 15000)}... [truncated]` : diff;

    const systemPrompt = `You are an expert software developer and technical writer who specializes in creating dual-tone release notes from Git diffs.
    
For each diff, you will generate two types of notes:
1. DEVELOPER NOTES: Technical, concise explanations focusing on what changed and why. Include specific code details, patterns, and technical implications.
2. MARKETING NOTES: User-centric descriptions highlighting the benefits and improvements from a user's perspective. Use simpler language and focus on value.

Respond in the following JSON format only:
{
  "developer": "Technical explanation of the changes...",
  "marketing": "User-friendly explanation of the benefits..."
}

Do not include any other text outside of this JSON structure.`;

    const userPrompt = `PR #${prId}: ${description}

Here's the diff:
\`\`\`
${truncatedDiff}
\`\`\`

Based on this diff, generate both developer and marketing release notes.`;

    // Send status to confirm processing has started
    const startMsg = {
      type: "status",
      status: "generating",
    };
    await writer.write(encoder.encode(`data: ${JSON.stringify(startMsg)}\n\n`));

    // Call OpenAI with streaming enabled
    const stream = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      stream: true,
    });

    let accumulatedContent = "";
    // Track the parsed content for incremental updates
    let currentDevNote = "";
    let currentMarketingNote = "";

    // Process the streaming response
    for await (const chunk of stream) {
      if (chunk.choices[0]?.delta?.content) {
        const content = chunk.choices[0].delta.content;
        accumulatedContent += content;

        try {
          // Attempt to parse as JSON, even if incomplete
          const parsed = tryParseJSON(accumulatedContent);

          // For partial updates, we need to extract content even when JSON is incomplete
          if (parsed.developer !== undefined) {
            currentDevNote = parsed.developer;
          }

          if (parsed.marketing !== undefined) {
            currentMarketingNote = parsed.marketing;
          }

          // Send incremental updates with every token
          const message = {
            type: "chunk",
            content: content,
            fullContent: accumulatedContent,
            parsed: {
              developer: currentDevNote,
              marketing: currentMarketingNote,
            },
          };

          await writer.write(
            encoder.encode(`data: ${JSON.stringify(message)}\n\n`)
          );
          // eslint-disable-next-line no-empty
        } catch {
          // If parsing fails, use more aggressive regex extraction
          const devMatch = accumulatedContent.match(
            /"developer"\s*:\s*"([^"]*)"/
          );
          const marketingMatch = accumulatedContent.match(
            /"marketing"\s*:\s*"([^"]*)"/
          );

          if (devMatch && devMatch[1]) {
            currentDevNote = devMatch[1];
          }

          if (marketingMatch && marketingMatch[1]) {
            currentMarketingNote = marketingMatch[1];
          }

          // If no matches yet, look for partial matches
          if (!devMatch) {
            const partialDevMatch = accumulatedContent.match(
              /"developer"\s*:\s*"([^"]*)/
            );
            if (partialDevMatch && partialDevMatch[1]) {
              currentDevNote = partialDevMatch[1];
            }
          }

          if (!marketingMatch) {
            const partialMarketingMatch = accumulatedContent.match(
              /"marketing"\s*:\s*"([^"]*)/
            );
            if (partialMarketingMatch && partialMarketingMatch[1]) {
              currentMarketingNote = partialMarketingMatch[1];
            }
          }

          const message = {
            type: "chunk",
            content: content,
            fullContent: accumulatedContent,
            parsed: {
              developer: currentDevNote,
              marketing: currentMarketingNote,
            },
          };

          await writer.write(
            encoder.encode(`data: ${JSON.stringify(message)}\n\n`)
          );
        }

        // Force a flush to ensure data is sent immediately
        await writer.ready;
      }
    }

    // Send completion message
    const completeMsg = {
      type: "complete",
      content: accumulatedContent,
    };

    await writer.write(
      encoder.encode(`data: ${JSON.stringify(completeMsg)}\n\n`)
    );
    await writer.close();
  } catch (error) {
    // Send error message
    const errorMsg = {
      type: "error",
      error: error instanceof Error ? error.message : "Unknown error",
    };

    await writer.write(encoder.encode(`data: ${JSON.stringify(errorMsg)}\n\n`));
    await writer.close();
  }
}

// Helper function to attempt to parse JSON that might be incomplete
function tryParseJSON(text: string) {
  // First try to parse the complete JSON
  try {
    return JSON.parse(text);
    // eslint-disable-next-line no-empty
  } catch {
    // Try different extraction methods

    // 1. Try to find a complete JSON object
    const jsonMatch = text.match(/\{[\s\S]*\}/);
    if (jsonMatch) {
      try {
        return JSON.parse(jsonMatch[0]);
      } catch {
        // Continue to other methods if this fails
      }
    }

    // 2. Look for quoted string values for both developer and marketing fields
    const developer = extractField(text, "developer");
    const marketing = extractField(text, "marketing");

    return {
      developer: developer || "",
      marketing: marketing || "",
    };
  }
}

// Helper function to extract field values from incomplete JSON
function extractField(text: string, fieldName: string): string | null {
  // First try to match completed quoted strings (with closing quote)
  const completedMatch = new RegExp(
    `"${fieldName}"\\s*:\\s*"([^"]*)"`,
    "i"
  ).exec(text);
  if (completedMatch && completedMatch[1]) {
    return completedMatch[1];
  }

  // Try to match partial strings (without closing quote)
  const partialMatch = new RegExp(`"${fieldName}"\\s*:\\s*"([^"]*)`, "i").exec(
    text
  );
  if (partialMatch && partialMatch[1]) {
    return partialMatch[1];
  }

  return null;
}
