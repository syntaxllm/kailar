/**
 * Azure OpenAI Service
 * Enterprise-grade LLM provider
 */

const AZURE_OPENAI_KEY = process.env.AZURE_OPENAI_KEY;
const AZURE_OPENAI_ENDPOINT = process.env.AZURE_OPENAI_ENDPOINT; // e.g., https://your-resource.openai.azure.com/
const AZURE_OPENAI_DEPLOYMENT = process.env.AZURE_OPENAI_DEPLOYMENT; // e.g., gpt-4o

export async function callAzureOpenAI(messages, jsonMode = false) {
    if (!AZURE_OPENAI_KEY || !AZURE_OPENAI_ENDPOINT) {
        throw new Error('Azure OpenAI not configured. Check your .env file.');
    }

    const url = `${AZURE_OPENAI_ENDPOINT}/openai/deployments/${AZURE_OPENAI_DEPLOYMENT}/chat/completions?api-version=2024-02-15-preview`;

    const body = {
        messages,
        temperature: 0.7,
        max_tokens: 2048
    };

    if (jsonMode) {
        body.response_format = { type: 'json_object' };
    }

    const response = await fetch(url, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'api-key': AZURE_OPENAI_KEY
        },
        body: JSON.stringify(body)
    });

    if (!response.ok) {
        throw new Error(`Azure OpenAI Error: ${response.status} - ${await response.text()}`);
    }

    const data = await response.json();
    return data.choices[0].message.content;
}
