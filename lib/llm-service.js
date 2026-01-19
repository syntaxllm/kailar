/**
 * LLM Service using Groq API
 * Handles: Chat, Summaries, Action Item Extraction
 */

const GROQ_API_KEY = process.env.GROQ_API_KEY;
const GROQ_MODEL = 'llama-3.3-70b-versatile';
const GROQ_API_URL = 'https://api.groq.com/openai/v1/chat/completions';

/**
 * Call Groq API with prompt
 */
async function callGroq(messages, jsonMode = false) {
    if (!GROQ_API_KEY || GROQ_API_KEY === 'your_groq_api_key_here') {
        throw new Error('GROQ_API_KEY not configured. Please set it in .env file');
    }

    const requestBody = {
        model: GROQ_MODEL,
        messages: messages,
        temperature: 0.7,
        max_tokens: 2048,
        top_p: 1,
        stream: false,
        stop: null,
    };

    if (jsonMode) {
        requestBody.response_format = { type: 'json_object' };
    }

    const response = await fetch(GROQ_API_URL, {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${GROQ_API_KEY}`
        },
        body: JSON.stringify(requestBody)
    });

    if (!response.ok) {
        const error = await response.text();
        throw new Error(`Groq API error: ${response.status} - ${error}`);
    }

    const data = await response.json();
    const text = data?.choices?.[0]?.message?.content;

    if (!text) {
        throw new Error('No response from Groq API');
    }

    return text;
}

/**
 * Generate meeting summary
 */
export async function generateSummary(meetingData) {
    const { meetingId, entries } = meetingData;

    // Build transcript text
    const transcriptText = entries
        .map(e => `[${e.start}] ${e.speaker}: ${e.text}`)
        .join('\n');

    const messages = [
        { role: 'system', content: 'You are an expert meeting analyst. Provide clear, concise, and actionable summaries.' },
        {
            role: 'user', content: `Analyze the following meeting transcript and generate a comprehensive summary.

TRANSCRIPT:
${transcriptText}

Please provide:
1. **Executive Summary** (3-4 sentences capturing the essence)
2. **Key Topics Discussed** (bullet points)
3. **Decisions Made** (bullet points with who decided what)
4. **Next Steps** (bullet points)
5. **Participants** (list with their main contributions)

Format your response in clean markdown.` }
    ];

    try {
        const response = await callGroq(messages);
        return {
            meetingId,
            summary: response,
            generatedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Summary generation failed:', error);
        throw error;
    }
}

/**
 * Extract action items from meeting
 */
export async function extractActionItems(meetingData) {
    const { meetingId, entries } = meetingData;

    const transcriptText = entries
        .map(e => `[${e.start}] ${e.speaker}: ${e.text}`)
        .join('\n');

    const messages = [
        { role: 'system', content: 'You are an expert meeting analyst that extracts action items in JSON format.' },
        {
            role: 'user', content: `Analyze this meeting transcript and extract ALL action items.

TRANSCRIPT:
${transcriptText}

Return a JSON object with an "actionItems" key containing an array of objects.
Each object must have:
- "task": what needs to be done
- "owner": who is responsible
- "deadline": when it's due
- "context": brief context from discussion
- "priority": High/Medium/Low

Only return valid JSON.` }
    ];

    try {
        const response = await callGroq(messages, true);
        const data = JSON.parse(response);

        return {
            meetingId,
            actionItems: data.actionItems || [],
            extractedAt: new Date().toISOString()
        };
    } catch (error) {
        console.error('Action item extraction failed:', error);
        throw error;
    }
}

/**
 * Chat with meeting context (RAG)
 */
export async function chatWithMeeting(question, chunks, chatHistory = []) {
    // Build context from relevant chunks
    const context = chunks
        .slice(0, 10)
        .map((chunk, idx) => `[Chunk ${idx + 1}]\n${chunk.text}`)
        .join('\n\n');

    const messages = [
        { role: 'system', content: 'You are a helpful AI assistant analyzing meeting transcripts. Answer the user\'s question based ONLY on the provided meeting context. If the answer isn\'t in the context, say "I don\'t see that information in this meeting transcript".' },
        ...chatHistory.map(msg => ({ role: msg.role === 'user' ? 'user' : 'assistant', content: msg.content })),
        {
            role: 'user', content: `MEETING CONTEXT:
${context}

USER QUESTION: ${question}

Answer:` }
    ];

    try {
        const response = await callGroq(messages);
        return {
            question,
            answer: response,
            timestamp: new Date().toISOString()
        };
    } catch (error) {
        console.error('Chat failed:', error);
        throw error;
    }
}

/**
 * Simple Keyword Retrieval (RAG)
 * Uses standard MongoDB regex search (Zero Cost / High Reliability)
 */
export async function searchChunksSemantic(query, meetingId, limit = 10) {
    try {
        const { searchChunksKeyword } = await import('./storage-prod.js');
        // Search Native DB (Keyword Mode)
        return await searchChunksKeyword(query, meetingId, limit);
    } catch (err) {
        console.error("Keyword Search failed:", err);
        return [];
    }
}

/**
 * Fallback: Keyword-based Search
 */
export function searchChunksKeywords(query, allChunks, limit = 10) {
    const queryLower = query.toLowerCase();
    const keywords = queryLower.split(/\s+/).filter(w => w.length > 2);

    const scored = allChunks.map(chunk => {
        const textLower = chunk.text.toLowerCase();
        let score = 0;
        keywords.forEach(keyword => {
            if (textLower.includes(keyword)) score += 1;
        });
        if (textLower.includes(queryLower)) score += 5;
        return { ...chunk, relevanceScore: score };
    });

    return scored
        .filter(c => c.relevanceScore > 0)
        .sort((a, b) => b.relevanceScore - a.relevanceScore)
        .slice(0, limit);
}
