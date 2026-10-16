declare module 'jsdom' {
  export class JSDOM {
    constructor(html: string)
    window: {
      document: Document
      close(): void
    }
  }
}
