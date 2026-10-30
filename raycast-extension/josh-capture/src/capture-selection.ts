import { getPreferenceValues, getSelectedText, showHUD } from "@raycast/api";

interface Preferences {
  portalUrl: string;
  token: string;
  tag?: string;
}

interface ApiError {
  error?: { message?: string };
}

function trimBase(value: string): string {
  return String(value || "")
    .trim()
    .replace(/\/+$/, "");
}

function singleTag(value: string | undefined): string[] {
  const tag = String(value || "")
    .trim()
    .replace(/^#+/, "")
    .split(/[,\s，、#]+/)
    .find(Boolean);
  return tag ? [tag] : [];
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:";
  } catch {
    return false;
  }
}

function isImageUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return /\.(png|jpe?g|webp|gif|avif)$/i.test(url.pathname);
  } catch {
    return false;
  }
}

function altFromUrl(value: string): string {
  try {
    const name =
      new URL(value).pathname.split("/").filter(Boolean).pop() || "image";
    return name.replace(/\.[^.]+$/, "") || "image";
  } catch {
    return "image";
  }
}

async function post(
  path: string,
  body: unknown,
  base: string,
  token: string,
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(20_000),
  });
}

export default async function Command() {
  try {
    const text = (await getSelectedText()).trim();
    if (!text) {
      await showHUD("Josh：没有选中文字");
      return;
    }

    const preferences = getPreferenceValues<Preferences>();
    const base = trimBase(preferences.portalUrl);
    const token = String(preferences.token || "").trim();
    if (!base || !token) {
      await showHUD("Josh：先在扩展设置里填门户地址和 Token");
      return;
    }

    const tags = singleTag(preferences.tag);
    let response: Response;

    if (isImageUrl(text)) {
      const alt = altFromUrl(text);
      response = await post(
        "/api/fragments",
        {
          kind: "image",
          quote: alt,
          sourceUrl: text,
          tags,
          metadata: { image: { src: text, pageUrl: text, alt } },
        },
        base,
        token,
      );
    } else if (isHttpUrl(text)) {
      response = await post(
        "/api/fragments/link",
        { url: text, tags },
        base,
        token,
      );
    } else {
      response = await post(
        "/api/fragments",
        { kind: "quote", quote: text, tags },
        base,
        token,
      );
    }

    if (response.status === 409) {
      await showHUD("Josh：这条已经在 Inbox 里了");
      return;
    }
    if (!response.ok) {
      const payload = (await response
        .json()
        .catch(() => null)) as ApiError | null;
      throw new Error(payload?.error?.message || `HTTP ${response.status}`);
    }

    await showHUD(
      tags.length > 0
        ? `Josh：已存入 Inbox · #${tags[0]}`
        : "Josh：已存入 Inbox",
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await showHUD(`Josh：${message.slice(0, 120)}`);
  }
}
