/**
 * Vector Service
 * Bridges our text to the AI meaning (Embeddings)
 */

const GEMINI_API_KEY = process.env.GEMINI_API_KEY;
const EMBEDDING_MODEL = "text-embedding-004";
const API_URL = `https://generativelanguage.googleapis.com/v1beta/models/${EMBEDDING_MODEL}:embedContent`;

export async function generateEmbedding(text) {
    if (!GEMINI_API_KEY) {
        throw new Error("GEMINI_API_KEY missing. Cannot perform Vector Search.");
    }

    const response = await fetch(`${API_URL}?key=${GEMINI_API_KEY}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
            content: { parts: [{ text }] }
        })
    });

    if (!response.ok) throw new Error("Embedding API failed.");
    const data = await response.json();
    return data.embedding.values;
}
