const test = require("node:test");
const assert = require("node:assert/strict");

const {
  validateFeedbackPayload,
  buildNotionPayload,
} = require("../api/feedback.js");

test("validateFeedbackPayload accepts the portfolio feedback fields", () => {
  const input = {
    categories: ["문제 정의", "데이터 근거"],
    sentiment: "좋았어요",
    score: 4,
    comment: "문제 정의 흐름이 명확했습니다.",
    pageUrl: "https://oasisyou.github.io/portfolio/",
  };

  const result = validateFeedbackPayload(input);

  assert.deepEqual(result.categories, ["문제 정의", "데이터 근거"]);
  assert.equal(result.sentiment, "좋았어요");
  assert.equal(result.score, 4);
  assert.equal(result.comment, "문제 정의 흐름이 명확했습니다.");
  assert.equal(result.pageUrl, "https://oasisyou.github.io/portfolio/");
});

test("validateFeedbackPayload rejects missing categories", () => {
  assert.throws(
    () =>
      validateFeedbackPayload({
        categories: [],
        sentiment: "좋았어요",
        score: 4,
        comment: "좋았습니다.",
        pageUrl: "https://oasisyou.github.io/portfolio/",
      }),
    /category/i
  );
});

test("buildNotionPayload maps feedback to Notion database properties", () => {
  const payload = buildNotionPayload(
    "f3ea43c3334546ad95085ac5d07e4d57",
    {
      categories: ["문제 정의", "데이터 근거"],
      sentiment: "더 궁금해요",
      score: 5,
      comment: "추가 실험 결과도 궁금합니다.",
      pageUrl: "https://oasisyou.github.io/portfolio/#case2",
      submittedAt: "2026-06-02T09:00:00.000Z",
    }
  );

  assert.equal(payload.parent.database_id, "f3ea43c3334546ad95085ac5d07e4d57");
  assert.deepEqual(payload.properties["카테고리"].multi_select, [
    { name: "문제 정의" },
    { name: "데이터 근거" },
  ]);
  assert.deepEqual(payload.properties["느낌"].select, { name: "더 궁금해요" });
  assert.equal(payload.properties["점수"].number, 5);
  assert.equal(
    payload.properties["의견"].rich_text[0].text.content,
    "추가 실험 결과도 궁금합니다."
  );
  assert.equal(
    payload.properties["페이지 URL"].url,
    "https://oasisyou.github.io/portfolio/#case2"
  );
  assert.equal(payload.properties["제출 시간"].date.start, "2026-06-02T09:00:00.000Z");
});
