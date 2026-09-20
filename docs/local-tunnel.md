# Mobile testing with a temporary tunnel

Install Cloudflare's `cloudflared` binary, then run `bun run tunnel` from the repository root. Keep that process running. It exposes only the local Worker port and exports its process logs to Aspire. The generated HTTPS origin is saved in the ignored `artifacts/tunnel-origin.txt`.

Restart Aspire using that origin so authentication, verification links and cookies use HTTPS:

```sh
aspire stop
PUBLIC_ORIGIN=$(cat artifacts/tunnel-origin.txt) aspire start
aspire wait todo
```

Open the generated URL followed by `/todos` on your phone. Existing local accounts work; new signup verification messages are captured in the local inbox at `http://127.0.0.1:8810`. Open the inbox on the development machine to verify the account. The inbox, private binding bridge and Aspire dashboard are not tunneled.

The app still runs locally. Anyone with the temporary URL can reach its normal login/signup pages. The address lasts only while `cloudflared` runs and changes when it restarts. Stop the tunnel with Ctrl+C, then `aspire stop` and `aspire start` without `PUBLIC_ORIGIN` to restore localhost authentication.

`PUBLIC_ORIGIN` selects the canonical public HTTPS origin while local listener ports and private backchannels remain unchanged. Local Worker forwarding uses this explicit configuration rather than trusting incoming forwarded headers. No cloud deployment is performed.

Tunnel logs appear as `flarestack.tunnel` in Aspire. The wrapper discovers the active AppHost's authenticated OTLP receiver and buffers output while Aspire is restarting. Keep this command running from the repository root so discovery selects this app.
