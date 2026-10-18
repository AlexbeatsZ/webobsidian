declare module 'codemirror' {
  const CodeMirror: any;
  export default CodeMirror;
}
declare module 'codemirror/mode/javascript/javascript';
declare module 'turndown' {
  export default class TurndownService {
    turndown(html: string): string;
  }
}
