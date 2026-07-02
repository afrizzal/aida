// Spam trap (D-20): a normal-looking text field named "company_website" that real
// visitors never see or fill in. Visually hidden via off-screen positioning (NOT
// `type="hidden"` and NOT `aria-hidden`) — naive bots that auto-fill every field
// still fill this one, while a real screen-reader user hears the warning label and
// knows to leave it blank. The intake route silently succeeds (no ticket created)
// whenever this field is non-empty.
export function HoneypotField() {
  return (
    <label
      htmlFor="company_website"
      className="absolute left-[-9999px] top-auto h-px w-px overflow-hidden"
    >
      Leave this field blank
      <input
        id="company_website"
        type="text"
        name="company_website"
        tabIndex={-1}
        autoComplete="off"
      />
    </label>
  );
}
