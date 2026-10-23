import en from './locale/en';
import zh from './locale/zh-cn';
export type LanguageStringKey = string;
let locale = 'zh-CN';
export function setLanguage(value: string) {
  locale = value;
}
export function getTextInLanguage(key: string): string {
  const read = (source: unknown) => key.split('.').reduce<any>((a, k) => a?.[k], source);
  return (locale.startsWith('zh') ? read(zh) : undefined) ?? read(en) ?? key;
}
