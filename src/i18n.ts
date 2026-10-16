import english from "./i18n/en_US.json";
export type Translator = (key: string, values?: Record<string, string | number>) => string;
export function translator(messages: Record<string, unknown>): Translator {
  return (key, values = {}) => {
    let value = (typeof messages[key] === "string" ? messages[key] as string : undefined) || (english as Record<string, string>)[key] || key;
    for (const [name, replacement] of Object.entries(values)) value = value.replaceAll(`{${name}}`, String(replacement));
    return value;
  };
}
