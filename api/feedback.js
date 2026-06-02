const ALLOWED_CATEGORIES = new Set([
  "문제 정의",
  "해결 방식",
  "데이터 근거",
  "구성/흐름",
  "디자인/가독성",
  "역량 전달",
  "기타",
]);

const ALLOWED_SENTIMENTS = new Set(["좋았어요", "아쉬웠어요", "더 궁금해요"]);

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function normalizeText(value, maxLength) {
  return String(value || "").trim().slice(0, maxLength);
}

function validateFeedbackPayload(input) {
  const payload = input && typeof input === "object" ? input : {};
  const categories = asArray(payload.categories)
    .map((item) => normalizeText(item, 40))
    .filter((item) => ALLOWED_CATEGORIES.has(item));
  const sentiment = normalizeText(payload.sentiment, 20);
  const score = Number(payload.score);
  const comment = normalizeText(payload.comment, 1200);
  const pageUrl = normalizeText(payload.pageUrl, 500);
  const submittedAt = normalizeText(payload.submittedAt, 60) || new Date().toISOString();

  if (categories.length < 1) {
    throw new Error("At least one feedback category is required.");
  }

  if (!ALLOWED_SENTIMENTS.has(sentiment)) {
    throw new Error("A valid feedback sentiment is required.");
  }

  if (!Number.isInteger(score) || score < 1 || score > 5) {
    throw new Error("A score from 1 to 5 is required.");
  }

  if (comment.length < 1) {
    throw new Error("A feedback comment is required.");
  }

  let safePageUrl = pageUrl;
  if (safePageUrl) {
    try {
      const parsed = new URL(safePageUrl);
      safePageUrl = parsed.href;
    } catch (_error) {
      safePageUrl = "";
    }
  }

  return {
    categories,
    sentiment,
    score,
    comment,
    pageUrl: safePageUrl,
    submittedAt,
  };
}

function buildNotionPayload(databaseId, feedback) {
  const title = `${feedback.sentiment} · ${feedback.categories.join(", ")}`;

  return {
    parent: { database_id: databaseId },
    properties: {
      제목: {
        title: [{ text: { content: title.slice(0, 120) } }],
      },
      카테고리: {
        multi_select: feedback.categories.map((name) => ({ name })),
      },
      느낌: {
        select: { name: feedback.sentiment },
      },
      점수: {
        number: feedback.score,
      },
      의견: {
        rich_text: [{ text: { content: feedback.comment } }],
      },
      "페이지 URL": {
        url: feedback.pageUrl || null,
      },
      "제출 시간": {
        date: { start: feedback.submittedAt },
      },
    },
  };
}

function getAllowedOrigin(origin) {
  if (!origin) return "";

  const configured = (process.env.ALLOWED_ORIGINS || "")
    .split(",")
    .map((item) => item.trim())
    .filter(Boolean);

  if (configured.includes(origin)) return origin;

  try {
    const parsed = new URL(origin);
    if (parsed.hostname === "localhost" || parsed.hostname === "127.0.0.1") return origin;
    if (parsed.hostname === "oasisyou.github.io") return origin;
    if (parsed.hostname.endsWith(".vercel.app")) return origin;
  } catch (_error) {
    return "";
  }

  return "";
}

function setCorsHeaders(req, res) {
  const allowedOrigin = getAllowedOrigin(req.headers.origin);
  if (allowedOrigin) {
    res.setHeader("Access-Control-Allow-Origin", allowedOrigin);
    res.setHeader("Vary", "Origin");
  }
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  return allowedOrigin;
}

async function handler(req, res) {
  const allowedOrigin = setCorsHeaders(req, res);

  if (req.method === "OPTIONS") {
    res.status(204).end();
    return;
  }

  if (req.method !== "POST") {
    res.status(405).json({ ok: false, error: "Method not allowed." });
    return;
  }

  if (req.headers.origin && !allowedOrigin) {
    res.status(403).json({ ok: false, error: "Origin is not allowed." });
    return;
  }

  if (req.body && req.body.website) {
    res.status(200).json({ ok: true });
    return;
  }

  const token = process.env.NOTION_TOKEN;
  const databaseId = process.env.NOTION_DATABASE_ID;

  if (!token || !databaseId) {
    res.status(500).json({ ok: false, error: "Notion environment variables are missing." });
    return;
  }

  let feedback;
  try {
    feedback = validateFeedbackPayload(req.body);
  } catch (error) {
    res.status(400).json({ ok: false, error: error.message });
    return;
  }

  const notionResponse = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(buildNotionPayload(databaseId, feedback)),
  });

  if (!notionResponse.ok) {
    const detail = await notionResponse.text();
    console.error("Notion feedback insert failed", notionResponse.status, detail);
    res.status(502).json({ ok: false, error: "Failed to save feedback." });
    return;
  }

  res.status(200).json({ ok: true });
}

module.exports = handler;
module.exports.validateFeedbackPayload = validateFeedbackPayload;
module.exports.buildNotionPayload = buildNotionPayload;
module.exports.getAllowedOrigin = getAllowedOrigin;
