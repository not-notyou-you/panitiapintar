/** Generic error with the requestId the visitor can quote to the committee (INTERFACE §5 ErrorState). */
export function ErrorState({ message, requestId }: { message: string; requestId?: string | null }) {
  return (
    <div role="alert" className="pii">
      <p className="m-0">{message}</p>
      {requestId ? (
        <p className="m-0 mt-1 text-[11px]">
          Kode permintaan: <code className="select-all">{requestId}</code>
        </p>
      ) : null}
    </div>
  );
}
