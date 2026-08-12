/*
Cloudflare Worker to store puzzles in a KV namespace named `PUZZLES`.

Bindings required in Cloudflare dashboard (or wrangler):
- A KV Namespace bound to `PUZZLES`.

Optional environment variable bindings (as a Worker Secret or plain env):
- WRITE_SECRET (string) - if set, POST requests must include header `x-write-secret: <value>`
- WEBHOOK_URL (string) - if set, successful puzzle publication sends a Discord webhook notification

Features & abuse protections:
- Validates payload schema and max lengths
- Rejects payloads containing HTML tags / script-like tags
- Per-IP daily upload cap using the same KV namespace with `ip:` prefix (stored with 24h TTL)
- Max body size enforced (200KB)
- Stored items get an expiration TTL (in seconds) derived from payload.expiresAt or capped to 365 days
*/

addEventListener('fetch', (event) => {
    event.respondWith(handleRequest(event.request, event));
});

// Configuration
const MAX_BODY_BYTES = 200 * 1024; // 200KB
const MAX_CLUE_LENGTH = 5000;
const MAX_ANSWER_LENGTH = 200;
const MAX_HINTS = 12;
const MAX_HINT_LENGTH = 1000;
const MAX_UPLOADS_PER_IP_PER_DAY = 30;
const DEFAULT_RETENTION_DAYS = 365;

// Allow CORS from anywhere by default; you can change this to restrict origins.
const CORS_HEADERS = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Methods': 'GET,POST,OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
};

function jsonResponse(body, status = 200, extraHeaders = {}) {
    return new Response(JSON.stringify(body), {
        status,
        headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS, extraHeaders),
    });
}

function textResponse(text, status = 200, extraHeaders = {}) {
    return new Response(text, {
        status,
        headers: Object.assign({ 'Content-Type': 'text/plain' }, CORS_HEADERS, extraHeaders),
    });
}

async function handleRequest(request, event) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { headers: CORS_HEADERS });
    }

    const url = new URL(request.url);
    const parts = url.pathname.replace(/^\/+/, '').split('/');

    try {
        if (request.method === 'GET' && parts[0] === 'p' && parts[1]) {
            // GET /p/:id
            const id = parts[1];
            const stored = await globalThis.PUZZLES.get(id);
            if (!stored) return jsonResponse({ error: 'Not found' }, 404);
            // Return stored JSON as-is
            return new Response(stored, { status: 200, headers: Object.assign({ 'Content-Type': 'application/json' }, CORS_HEADERS) });
        }

        if (request.method === 'POST' && parts[0] === 'p') {

            // Read body text to enforce size limit
            const bodyText = await request.text();
            if (bodyText.length > MAX_BODY_BYTES) {
                return jsonResponse({ error: 'Payload too large' }, 413);
            }

            let payload;
            try {
                payload = JSON.parse(bodyText);
            } catch (err) {
                return jsonResponse({ error: 'Invalid JSON' }, 400);
            }

            // Basic schema validation
            const clue = String(payload.clue || '').trim();
            const answer = String(payload.answer || '').trim();
            const author = payload.author == null ? '' : String(payload.author).trim();
            const hints = Array.isArray(payload.hints) ? payload.hints : [];

            if (!answer || answer.length > MAX_ANSWER_LENGTH) {
                return jsonResponse({ error: 'Answer missing or too long' }, 400);
            }
            if (!clue || clue.length > MAX_CLUE_LENGTH) {
                return jsonResponse({ error: 'Clue missing or too long' }, 400);
            }
            if (hints.length > MAX_HINTS) {
                return jsonResponse({ error: 'Too many hints' }, 400);
            }

            // Validate each hint
            for (const h of hints) {
                const text = (h && h.text) ? String(h.text) : '';
                if (text.length > MAX_HINT_LENGTH) {
                    return jsonResponse({ error: 'Hint too long' }, 400);
                }
            }

            // Reject HTML / script-like content
            const suspicious = /<\s*(script|iframe|img|object|embed|svg|video|audio|style)[\s>]/i;
            if (suspicious.test(clue) || suspicious.test(answer) || suspicious.test(author) || hints.some(h => suspicious.test(String(h.text || '')))) {
                return jsonResponse({ error: 'HTML or embedded content not allowed' }, 400);
            }

            // Rate-limit per IP per day (simple counter stored in KV with 24h TTL)
            const ip = request.headers.get('cf-connecting-ip') || request.headers.get('x-forwarded-for') || 'anon';
            const dayKey = `ip:${ip}:${(new Date()).toISOString().slice(0, 10)}`; // YYYY-MM-DD
            const ipCountRaw = await globalThis.PUZZLES.get(dayKey);
            const ipCount = ipCountRaw ? Number(ipCountRaw) : 0;
            if (ipCount >= MAX_UPLOADS_PER_IP_PER_DAY) {
                return jsonResponse({ error: 'Upload quota exceeded for this IP today' }, 429);
            }

            // All checks passed — store the puzzle
            const id = generateId();

            // TTL: always use default retention (no expiresAt handling)
            const ttlSeconds = DEFAULT_RETENTION_DAYS * 24 * 60 * 60;

            // canonicalize a little: only keep expected keys

            const storedPayload = {
                date: payload.date || new Date().toISOString(),
                author: author || '',
                clue,
                answer,
                hints: hints.map(h => ({ id: h.id || null, text: String(h.text || ''), type: (h && h.type) || 'indicator', words: Array.isArray(h && h.words) ? h.words.map(Number).filter(Number.isInteger) : [] })),
                par: Number.isInteger(payload.par) ? payload.par : 0,
            };

            await globalThis.PUZZLES.put(id, JSON.stringify(storedPayload), { expirationTtl: ttlSeconds });

            if (globalThis.WEBHOOK_URL) {
                const notification = sendDiscordPublicationNotification(request, id, storedPayload);
                if (event && typeof event.waitUntil === 'function') {
                    event.waitUntil(notification);
                } else {
                    await notification;
                }
            }

            // increment ip counter
            const newCount = ipCount + 1;
            // store with 24h TTL
            await globalThis.PUZZLES.put(dayKey, String(newCount), { expirationTtl: 24 * 60 * 60 });

            return jsonResponse({ id }, 201);
        }

        return jsonResponse({ error: 'Not found' }, 404);
    } catch (err) {
        // avoid leaking internal error details
        return jsonResponse({ error: 'Server error' }, 500);
    }
}

function generateId(length = 10) {
    // base62-ish id
    const alphabet = '0123456789abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ';
    let s = '';
    for (let i = 0; i < length; i++) s += alphabet[Math.floor(Math.random() * alphabet.length)];
    return s;
}

function sendDiscordPublicationNotification(request, id, puzzle) {
    const webhookUrl = globalThis.WEBHOOK_URL;
    if (!webhookUrl) {
        return Promise.resolve();
    }

    const puzzleUrl = "https://dan1eltheman1el.github.io/custom-cryptic/?p=" + encodeURIComponent(id);
    const hintCounts = countHintsByType(puzzle.hints || []);
    const letterCount = countAnswerLetters(puzzle.answer);

    return fetch(webhookUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
            allowed_mentions: { parse: [] },
            embeds: [{
                title: 'New Puzzle Published!',
                url: puzzleUrl,
                color: 0xadd3ff,
                description: '**Clue:**\n' + truncateForDiscord(puzzle.clue || '', 1024),
                author: { name: truncateForDiscord(puzzle.author || 'Anonymous', 1024) },
                timestamp: new Date().toISOString(),
                fields: [
                    { name: 'Letters', value: String(letterCount), inline: true },
                    { name: 'Par', value: String(Number.isInteger(puzzle.par) ? puzzle.par : 0), inline: true },
                    { name: 'Hint types', value: truncateForDiscord(formatHintCounts(hintCounts), 1024), inline: false }
                ],
            }],
        }),
    }).then((response) => {
        if (!response.ok) {
            throw new Error(`Discord webhook failed with ${response.status}`);
        }
    }).catch((err) => {
        console.warn('Discord publication notification failed', err);
    });
}

function countAnswerLetters(value) {
    return String(value || '')
        .toUpperCase()
        .replace(/[^A-Z ]/g, '')
        .replace(/\s/g, '')
        .length;
}

function countHintsByType(hints) {
    return (Array.isArray(hints) ? hints : []).reduce((counts, hint) => {
        const type = normalizeHintType(hint && hint.type);
        counts[type] += 1;
        return counts;
    }, { indicator: 0, fodder: 0, definition: 0 });
}

function normalizeHintType(type) {
    return ['indicator', 'fodder', 'definition'].includes(type) ? type : 'indicator';
}

function formatHintCounts(counts) {
    return ['indicator', 'fodder', 'definition']
        .map((type) => `${type}: ${counts[type] || 0}`)
        .join(', ');
}

function truncateForDiscord(value, maxLength = 1024) {
    const text = String(value == null ? '' : value);
    if (text.length <= maxLength) {
        return text;
    }

    return `${text.slice(0, Math.max(0, maxLength - 1))}…`;
}
