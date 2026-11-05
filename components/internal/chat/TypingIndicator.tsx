export function TypingIndicator() {
  return (
    <div className="msg msg-bot" aria-label="Chatbot sedang mengetik">
      <span className="typing" aria-hidden="true">
        <i />
        <i />
        <i />
      </span>
    </div>
  );
}
