/** A position in a token stream, with the lookahead a COBOL parser needs. */

import { CobolSyntaxError, type Token } from "./source";

export class Cursor {
  private readonly tokens: Token[];
  private at = 0;

  public constructor(tokens: Token[]) {
    this.tokens = tokens;
  }

  public peek(ahead = 0): Token {
    return (
      this.tokens[this.at + ahead] ?? {
        kind: "end",
        text: "",
        line: this.tokens[this.tokens.length - 1]?.line ?? 0,
        column: 0,
      }
    );
  }

  public get line(): number {
    return this.peek().line;
  }

  public get done(): boolean {
    return this.peek().kind === "end";
  }

  public next(): Token {
    const token = this.peek();
    this.at += 1;
    return token;
  }

  /** The index, so a parser can rewind a speculative read. */
  public get position(): number {
    return this.at;
  }

  public set position(value: number) {
    this.at = value;
  }

  /** True when the next tokens are exactly these words, in order. */
  public looksLike(...words: string[]): boolean {
    return words.every(
      (word, index) =>
        this.peek(index).kind === "word" && this.peek(index).text === word,
    );
  }

  /** Consumes the words when they are next, and reports whether it did. */
  public accept(...words: string[]): boolean {
    if (!this.looksLike(...words)) {
      return false;
    }
    this.at += words.length;
    return true;
  }

  public acceptPunct(text: string): boolean {
    if (this.peek().kind === "punct" && this.peek().text === text) {
      this.at += 1;
      return true;
    }
    return false;
  }

  public acceptPeriod(): boolean {
    if (this.peek().kind === "period") {
      this.at += 1;
      return true;
    }
    return false;
  }

  public expect(...words: string[]): void {
    if (!this.accept(...words)) {
      throw new CobolSyntaxError(
        `Line ${String(this.line)}: expected ${words.join(" ")}, found ${this.peek().text || "end of program"}.`,
      );
    }
  }

  public expectPunct(text: string): void {
    if (!this.acceptPunct(text)) {
      throw new CobolSyntaxError(
        `Line ${String(this.line)}: expected ${text}, found ${this.peek().text || "end of program"}.`,
      );
    }
  }

  /** `IS`, `ARE`, `THE` and friends: noise a COBOL clause may or may not carry. */
  public skipNoise(...words: string[]): void {
    let moved = true;
    while (moved) {
      moved = false;
      for (const word of words) {
        if (this.accept(word)) {
          moved = true;
        }
      }
    }
  }

  public word(): string {
    const token = this.next();
    if (token.kind !== "word") {
      throw new CobolSyntaxError(
        `Line ${String(token.line)}: expected a name, found ${token.text || "end of program"}.`,
      );
    }
    return token.text;
  }
}
