const digitMap: Record<string, string> = {
  '0': '٠',
  '1': '١',
  '2': '٢',
  '3': '٣',
  '4': '٤',
  '5': '٥',
  '6': '٦',
  '7': '٧',
  '8': '٨',
  '9': '٩',
};

export function toArabicDigits(text: string): string {
  return text.replace(
    /[A-Za-z0-9][A-Za-z0-9._\-/]*(?:[ \t]+[A-Za-z0-9][A-Za-z0-9._\-/]*)*/g,
    (phrase) =>
      /[A-Za-z]/.test(phrase)
        ? phrase
        : [...phrase].map((ch) => digitMap[ch] ?? ch).join(''),
  );
}
