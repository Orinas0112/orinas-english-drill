// Cloudflare Pages Function: POST /api/evaluate
// ブラウザにAPIキーを置かず、ここでAnthropic APIへ中継する。
// 必要な環境変数: ANTHROPIC_API_KEY

const MODEL = "claude-sonnet-4-6";

const SYSTEM_PROMPT = `あなたは日本人のビジネスパーソン向けの英語ライティング講師です。
学習者は、与えられた業務シナリオに沿って、指定された英単語・表現をすべて使い、英文を書きます。
あなたはその英文を添削し、必ず次のJSONオブジェクトのみを返してください（前後に説明文やマークダウンのコードフェンスを付けない）。

{
  "rating": 1〜5の整数（総合評価。5が最高）,
  "comment": "全体の講評（日本語で1〜2文、励ましつつ的確に）",
  "vocabCheck": [
    { "word": "指定された単語そのまま", "used": その単語が使われていればtrue, "correct": 文脈的に正しく使えていればtrue, "note": "日本語の短いコメント" }
  ],
  "grammar": "文法面の指摘（日本語。問題なければ良い点を述べる）",
  "naturalness": "自然さ・ビジネス英語としての適切さの指摘（日本語）",
  "improved": "学習者の意図を保ったまま、より自然でプロフェッショナルな英文に書き直した改善例（英語）"
}

ルール:
- vocabCheck には、指定された単語・表現を必ずすべて1つずつ含める。
- used が false の場合は correct も false にする。
- ratingは、指定語の活用・文法・自然さを総合して判断する。
- JSON以外は一切出力しない。`;

function json(body, status) {
  return new Response(JSON.stringify(body), {
    status: status || 200,
    headers: { "content-type": "application/json; charset=utf-8" },
  });
}

function extractJson(text) {
  if (!text) return null;
  let t = text.trim();
  // ```json ... ``` のフェンスを除去
  const fence = t.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fence) t = fence[1].trim();
  const start = t.indexOf("{");
  const end = t.lastIndexOf("}");
  if (start === -1 || end === -1 || end < start) return null;
  try {
    return JSON.parse(t.slice(start, end + 1));
  } catch (e) {
    return null;
  }
}

export async function onRequestPost(context) {
  const { request, env } = context;

  const apiKey = env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    return json({ error: "サーバーにAPIキーが設定されていません (ANTHROPIC_API_KEY)。" }, 500);
  }

  let payload;
  try {
    payload = await request.json();
  } catch (e) {
    return json({ error: "リクエストの形式が不正です。" }, 400);
  }

  const scenario = String(payload.scenario || "").slice(0, 1000);
  const words = Array.isArray(payload.words) ? payload.words.slice(0, 5).map(String) : [];
  const text = String(payload.text || "").slice(0, 2000);

  if (!text.trim()) {
    return json({ error: "英文が入力されていません。" }, 400);
  }

  const userPrompt =
    `業務シナリオ:\n${scenario}\n\n` +
    `必ず使う単語・表現: ${words.join(", ")}\n\n` +
    `学習者の英文:\n${text}`;

  let resp;
  try {
    resp = await fetch("https://api.anthropic.com/v1/messages", {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
        "anthropic-version": "2023-06-01",
      },
      body: JSON.stringify({
        model: MODEL,
        max_tokens: 1024,
        system: [
          { type: "text", text: SYSTEM_PROMPT, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: userPrompt }],
      }),
    });
  } catch (e) {
    return json({ error: "AIサービスへの接続に失敗しました。" }, 502);
  }

  if (!resp.ok) {
    const detail = await resp.text().catch(() => "");
    return json({ error: "AIサービスがエラーを返しました。", status: resp.status, detail: detail.slice(0, 300) }, 502);
  }

  const data = await resp.json().catch(() => null);
  const aiText = data && data.content && data.content[0] && data.content[0].text;
  const parsed = extractJson(aiText);

  if (!parsed) {
    return json({ error: "添削結果の解析に失敗しました。もう一度お試しください。" }, 502);
  }

  return json(parsed);
}
