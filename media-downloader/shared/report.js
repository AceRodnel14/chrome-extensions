// The result toast shared by every site's content script. background.js follows each click's downloads to the end
// and sends one "batchResult": { total, saved, savedFiles, failed: [{ filename, error }], dates: null | { total, set, notSet } }.
// Loaded as a plain script, so it exposes a single global: MDReport.
(() => {
  const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;
  const name = (filename) => filename.split("/").pop();

  // exiftool ends its errors with " - <full path>" and starts them with "Error: "; the file name is shown already.
  const reason = (error) => String(error || "unknown error").replace(/^Error: /, "").replace(/ - (\/|[A-Za-z]:\\).*$/, "");

  // "a.jpg: reason" for the first problem, plus how many more there are.
  function firstProblem(list) {
    const [first] = list;
    return `${name(first.filename)}: ${reason(first.error)}${list.length > 1 ? ` (and ${list.length - 1} more)` : ""}`;
  }

  // Shown while the downloads run.
  function waiting(count, dated) {
    return `Downloading ${plural(count, "file")}…${dated ? " The dates are set when they are done." : ""}`;
  }

  // The final message and its kind: success (everything saved and dated), warning (everything saved, some dates not
  // set), error (files missing).
  function summary({ total, saved, savedFiles = [], failed = [], dates }) {
    if (saved < total) {
      return { kind: "error", text: `Only ${saved} of ${plural(total, "file")} saved. Failed: ${firstProblem(failed)}` };
    }
    let text = total === 1 ? `Saved ${savedFiles[0] || "1 file"}.` : `Saved ${saved} of ${total} files.`;
    if (!dates) return { kind: "success", text };
    if (dates.set === dates.total) return { kind: "success", text: `${text} ${dates.total === 1 ? "Date set." : `Dates set on ${dates.total}.`}` };
    text += ` Dates set on ${dates.set} of ${dates.total}; not set: ${firstProblem(dates.notSet)}`;
    return { kind: "warning", text };
  }

  globalThis.MDReport = { waiting, summary };
})();
