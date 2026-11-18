export default function Journal() {
  return (
    <>
      <h1>Journal d'audit</h1>
      <p>À construire (C4) : lecture des events PaymentExecuted, PaymentQueued et AgentsRevoked via getLogsChunked (tranches de 1 000 blocs), puis export CSV.</p>
    </>
  );
}
