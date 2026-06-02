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

function findPropertyName(schemaProperties, aliases, expectedType) {
  if (!schemaProperties) return aliases[0];

  for (const alias of aliases) {
    if (schemaProperties[alias] && (!expectedType || schemaProperties[alias].type === expectedType)) {
      return alias;
    }
  }

  const fallback = Object.entries(schemaProperties).find(([, property]) => property.type === expectedType);
  return fallback ? fallback[0] : "";
}

function addPropertyIfFound(properties, name, value) {
  if (!name) return;
  properties[name] = value;
}

function buildNotionPayload(databaseId, feedback, schemaProperties) {
  const title = `${feedback.sentiment} · ${feedback.categories.join(", ")}`;
  const properties = {};

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["제목", "Name", "Title"], "title"),
    { title: [{ text: { content: title.slice(0, 120) } }] }
  );

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["카테고리", "Categories", "Category"], "multi_select"),
    { multi_select: feedback.categories.map((name) => ({ name })) }
  );

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["느낌", "Sentiment", "Reaction"], "select"),
    { select: { name: feedback.sentiment } }
  );

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["점수", "Score", "Rating"], "number"),
    { number: feedback.score }
  );

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["의견", "Comment", "Feedback"], "rich_text"),
    { rich_text: [{ text: { content: feedback.comment } }] }
  );

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["페이지 URL", "Page URL", "URL"], "url"),
    { url: feedback.pageUrl || null }
  );

  addPropertyIfFound(
    properties,
    findPropertyName(schemaProperties, ["제출 시간", "Submitted At", "Submitted"], "date"),
    { date: { start: feedback.submittedAt } }
  );

  return {
    parent: { database_id: databaseId },
    properties,
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

  const databaseResponse = await fetch(`https://api.notion.com/v1/databases/${databaseId}`, {
    method: "GET",
    headers: {
      Authorization: `Bearer ${token}`,
      "Notion-Version": "2022-06-28",
    },
  });

  if (!databaseResponse.ok) {
    const detail = await databaseResponse.text();
    console.error("Notion database lookup failed", databaseResponse.status, detail);
    res.status(502).json({
      ok: false,
      error: "Notion 데이터베이스를 확인하지 못했습니다. DB ID, 토큰, Integration 연결을 확인해주세요.",
    });
    return;
  }

  const database = await databaseResponse.json();

  const notionResponse = await fetch("https://api.notion.com/v1/pages", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token}`,
      "Content-Type": "application/json",
      "Notion-Version": "2022-06-28",
    },
    body: JSON.stringify(buildNotionPayload(databaseId, feedback, database.properties)),
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
