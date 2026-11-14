declare module "mammoth" {
  interface Message {
    type: "warning" | "error";
    message: string;
  }
  interface Result {
    value: string;
    messages: Message[];
  }
  /** ブラウザ版は arrayBuffer、Node 版は buffer を読む（中身はどちらも ArrayBuffer で可） */
  interface Input {
    arrayBuffer?: ArrayBuffer;
    buffer?: ArrayBuffer;
  }
  const mammoth: {
    convertToHtml(input: Input, options?: Record<string, unknown>): Promise<Result>;
  };
  export default mammoth;
}
