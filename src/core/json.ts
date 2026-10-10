/**
 * Parses JSON while preserving integers beyond `Number.MAX_SAFE_INTEGER`
 * (AliExpress order ids are 16-19 digits). Those literals are turned into
 * strings before `JSON.parse`, so the digits survive exactly.
 */
export function parseJsonPreservingLongs(text: string): unknown {
  // Fast path: no run of 16+ digits means nothing can exceed the safe range.
  if (!/\d{16}/.test(text)) return JSON.parse(text) as unknown;

  let output = '';
  let index = 0;
  const length = text.length;

  while (index < length) {
    const char = text[index];

    if (char === '"') {
      // Copy the whole string literal, honouring escapes.
      let end = index + 1;
      while (end < length && text[end] !== '"') {
        end += text[end] === '\\' ? 2 : 1;
      }
      output += text.slice(index, end + 1);
      index = end + 1;
      continue;
    }

    if (char === '-' || (char >= '0' && char <= '9')) {
      let end = index + 1;
      while (end < length && /[0-9.eE+-]/.test(text[end])) end++;
      const literal = text.slice(index, end);
      const isInteger = /^-?\d+$/.test(literal);
      if (isInteger && !Number.isSafeInteger(Number(literal))) {
        output += `"${literal}"`;
      } else {
        output += literal;
      }
      index = end;
      continue;
    }

    output += char;
    index++;
  }
  return JSON.parse(output) as unknown;
}
