import { NextResponse } from "next/server";
import { OpenAI } from "openai";

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    // Validate OpenAI API key
    if (!process.env.OPENAI_API_KEY) {
      return NextResponse.json(
        { error: "OpenAI API key is not configured" },
        { status: 500 }
      );
    }

    let reqBody;
    try {
      reqBody = await req.json();
    } catch {
      return NextResponse.json(
        { error: "Invalid JSON in request body" },
        { status: 400 }
      );
    }

    const { diff, prId, description } = reqBody;

    // Input validation
    if (!diff) {
      return NextResponse.json(
        { error: "Missing diff content" },
        { status: 400 }
      );
    }

    if (!prId) {
      return NextResponse.json({ error: "Missing PR ID" }, { status: 400 });
    }

    if (!description) {
      return NextResponse.json(
        { error: "Missing PR description" },
        { status: 400 }
      );
    }

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

    try {
      const response = await openai.chat.completions.create({
        model: process.env.OPENAI_MODEL || "gpt-4o-mini",
        messages: [
          { role: "system", content: systemPrompt },
          { role: "user", content: userPrompt },
        ],
        temperature: 0.7,
      });

      const content = response.choices[0]?.message?.content;

      if (!content) {
        throw new Error("No content in response from OpenAI");
      }

      // Parse the response and check for valid JSON
      try {
        const parsedResponse = JSON.parse(content);
        if (!parsedResponse.developer || !parsedResponse.marketing) {
          throw new Error("Response missing required fields");
        }

        // Return the parsed response
        return NextResponse.json(parsedResponse);
      } catch {
        throw new Error(
          `Failed to parse OpenAI response as JSON: ${content.substring(
            0,
            100
          )}...`
        );
      }
    } catch (openAIError: Error | unknown) {
      console.error("OpenAI API Error:", openAIError);
      const errorMessage =
        openAIError instanceof Error
          ? openAIError.message
          : "Unknown OpenAI error";
      return NextResponse.json(
        {
          error: "Error from OpenAI API",
          details: errorMessage,
        },
        { status: 500 }
      );
    }
  } catch (error: Error | unknown) {
    console.error("Error generating notes:", error);
    const errorMessage =
      error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      {
        error: "Failed to generate notes",
        details: errorMessage,
      },
      { status: 500 }
    );
  }
}
