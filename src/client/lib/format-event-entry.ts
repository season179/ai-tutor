type FormatEventEntryOptions = {
  omitNullValue?: boolean;
};

export function formatEventEntry(
  createdAt: string | Date,
  message: string,
  value?: unknown,
  options: FormatEventEntryOptions = {}
): string {
  const time = new Date(createdAt).toLocaleTimeString();
  const shouldRenderValue = value !== undefined && (value !== null || options.omitNullValue !== true);
  const renderedValue = shouldRenderValue ? ` ${JSON.stringify(value, null, 2)}` : "";

  return `[${time}] ${message}${renderedValue}`;
}
