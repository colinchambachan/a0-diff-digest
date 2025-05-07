import { NextResponse } from "next/server";
import { OpenAI } from "openai";
import { StreamingTextResponse, OpenAIStream } from "ai";

// Initialize the OpenAI client
const openai = new OpenAI({
  apiKey: process.env.OPENAI_API_KEY || "",
});

export const runtime = "edge";

export async function POST(req: Request) {
  try {
    const { diff, prId, description } = await req.json();

    if (!diff) {
      return NextResponse.json(
        { error: "Missing diff content" },
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

    const response = await openai.chat.completions.create({
      model: process.env.OPENAI_MODEL || "gpt-4o-mini",
      messages: [
        { role: "system", content: systemPrompt },
        { role: "user", content: userPrompt },
      ],
      temperature: 0.7,
      stream: true,
    });

    // Create a stream from the OpenAI response
    const stream = OpenAIStream(response);

    // Return a streaming response
    return new StreamingTextResponse(stream);
  } catch (error: any) {
    console.error("Error generating notes:", error);
    return NextResponse.json(
      {
        error: "Failed to generate notes",
        details: error.message || "Unknown error",
      },
      { status: 500 }
    );
  }
}
