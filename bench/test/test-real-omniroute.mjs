import { createMessage } from "../lib/llm.mjs";

async function run() {
  console.log("Testing real OmniRoute connection...");
  
  if (!process.env.OPENAI_API_BASE) {
    console.log("No OPENAI_API_BASE configured. Skipping real OmniRoute test.");
    return;
  }
  
  try {
    const resp = await createMessage({
      system: "You are a helpful assistant. Reply exactly with the word 'PONG'. Do not use any punctuation.",
      tools: [],
      messages: [{ role: "user", content: "PING" }],
      max_tokens: 10
    });
    
    console.log("Successfully connected and received response!");
    console.log("Response:", JSON.stringify(resp, null, 2));
  } catch (err) {
    console.error("Failed real OmniRoute test:", err);
    process.exit(1);
  }
}

run();
