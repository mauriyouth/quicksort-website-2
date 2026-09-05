import { useRef, useState } from "react";

const PUBLIC_LOGO_URL = "https://www.quicksort.fr/quicksort-signature-logo-v2.png";

const signatureMarkup = `
<table role="presentation" cellpadding="0" cellspacing="0" border="0" style="width:100%;max-width:560px;border-collapse:collapse;font-family:Arial,Helvetica,sans-serif;color:#141414;background:#ffffff;">
  <tbody>
    <tr>
      <td style="width:76px;padding:2px 20px 2px 0;vertical-align:top;">
        <img src="${PUBLIC_LOGO_URL}" width="72" height="72" alt="Quicksort" style="display:block;border:0;border-radius:16px;">
      </td>
      <td style="padding:0 0 0 20px;border-left:2px solid #CCFF00;vertical-align:top;">
        <p style="margin:0 0 3px;font-size:18px;line-height:22px;font-weight:700;letter-spacing:-0.2px;color:#141414;">Quicksort Team</p>
        <p style="margin:0 0 12px;font-size:12px;line-height:17px;font-weight:600;color:#727272;">We craft Human + AI</p>
        <p style="margin:0;font-size:12px;line-height:19px;color:#3A3A3A;">
          <a href="mailto:hello@quicksort.fr" style="color:#141414;text-decoration:none;">hello@quicksort.fr</a>
          <span style="color:#B6B6B6;">&nbsp;·&nbsp;</span>
          <a href="tel:+33630059901" style="color:#141414;text-decoration:none;">+33 6 30 05 99 01</a><br>
          <a href="https://www.quicksort.fr" style="color:#141414;text-decoration:none;font-weight:700;">quicksort.fr</a>
          <span style="color:#B6B6B6;">&nbsp;·&nbsp;</span>
          <span style="color:#727272;">Paris, France</span>
        </p>
      </td>
    </tr>
  </tbody>
</table>`;

export const EmailSignature = (): JSX.Element => {
  const signatureRef = useRef<HTMLDivElement>(null);
  const [copyState, setCopyState] = useState<"idle" | "copied" | "manual">("idle");

  const copySignature = async () => {
    if (!signatureRef.current) return;

    const html = signatureRef.current.innerHTML;
    const text = [
      "Quicksort Team",
      "We craft Human + AI",
      "hello@quicksort.fr · +33 6 30 05 99 01",
      "quicksort.fr · Paris, France",
    ].join("\n");

    try {
      await navigator.clipboard.write([
        new ClipboardItem({
          "text/html": new Blob([html], { type: "text/html" }),
          "text/plain": new Blob([text], { type: "text/plain" }),
        }),
      ]);
      setCopyState("copied");
      window.setTimeout(() => setCopyState("idle"), 2500);
    } catch {
      const selection = window.getSelection();
      const range = document.createRange();
      range.selectNodeContents(signatureRef.current);
      selection?.removeAllRanges();
      selection?.addRange(range);
      setCopyState("manual");
    }
  };

  return (
    <main className="min-h-screen bg-[#f4f4f2] text-[#141414] flex items-center justify-center p-4 sm:p-8 [font-family:Arial,Helvetica,sans-serif]">
      <section className="w-full max-w-[720px] rounded-3xl border border-black/10 bg-white p-5 shadow-[0_24px_70px_rgba(20,20,20,0.08)] sm:p-9">
        <div className="mb-7 flex items-center gap-2.5 text-[17px] font-bold tracking-[-0.3px]">
          <img src="/quicksort-signature-logo-v2.png" width="34" height="34" alt="" className="rounded-lg" />
          <span>Quicksort</span>
        </div>

        <p className="mb-2 text-xs font-bold uppercase tracking-[0.1em] text-[#727272]">Email signature</p>
        <h1 className="m-0 text-4xl font-bold leading-none tracking-[-0.055em] sm:text-5xl">Ready to copy</h1>
        <p className="mt-3.5 max-w-[520px] text-base leading-6 text-[#727272]">
          Copy the signature, then paste it into Gmail, Outlook, or Apple Mail.
        </p>

        <p className="mb-2 mt-8 text-xs font-bold uppercase tracking-[0.1em] text-[#727272]">Signature preview</p>
        <div className="overflow-x-auto rounded-2xl border border-black/10 bg-white p-5 sm:p-7">
          <div
            ref={signatureRef}
            className="min-w-[460px]"
            dangerouslySetInnerHTML={{ __html: signatureMarkup }}
          />
        </div>

        <button
          type="button"
          onClick={copySignature}
          className="mt-[18px] w-full rounded-xl border-0 bg-[#141414] px-5 py-[15px] text-sm font-bold text-white transition hover:-translate-y-px hover:bg-black focus-visible:outline focus-visible:outline-3 focus-visible:outline-offset-3 focus-visible:outline-[#CCFF00]"
        >
          {copyState === "copied" ? "Copied — paste it into Gmail" : "Copy signature"}
        </button>

        <p className="mt-3 min-h-[18px] text-center text-xs leading-[18px] text-[#727272]" aria-live="polite">
          {copyState === "manual"
            ? "The signature is selected. Press Ctrl+C, then paste it into Gmail."
            : "After pasting, click the logo in Gmail to choose Small, Medium, Large, or Original size."}
        </p>
      </section>
    </main>
  );
};
