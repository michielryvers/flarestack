namespace Flarestack.Authentication.Transport;

/// <summary>Routes authority requests through the private backchannel without following redirects.</summary>
public sealed class AuthorityBackchannelHandler(Uri authority, Uri backchannel, string? bridgeToken = null) : DelegatingHandler(new HttpClientHandler { AllowAutoRedirect = false })
{
    /// <summary>Rewrites requests only when their origin exactly matches the authority.</summary>
    public static Uri Rewrite(Uri request, Uri authority, Uri backchannel)
    {
        if (request.Scheme == authority.Scheme && request.Host == authority.Host && request.Port == authority.Port)
        {
            return new Uri(backchannel.GetLeftPart(UriPartial.Authority) + request.PathAndQuery);
        }

        return request;
    }

    protected override async Task<HttpResponseMessage> SendAsync(HttpRequestMessage request, CancellationToken cancellationToken)
    {
        if (request.RequestUri is not null)
        {
            var rewritten = Rewrite(request.RequestUri, authority, backchannel);
            if (rewritten != request.RequestUri && !string.IsNullOrEmpty(bridgeToken))
            {
                if (!backchannel.IsLoopback)
                {
                    throw new InvalidOperationException("Local bridge credentials require a loopback backchannel.");
                }
                request.Headers.Add("x-flarestack-bridge", bridgeToken);
            }
            if (rewritten != request.RequestUri)
            {
                request.Headers.Add("x-flarestack-protocol", Internal.Protocol.Version);
                request.Headers.Add("x-flarestack-release", Internal.Protocol.Release);
            }
            request.RequestUri = rewritten;
        }

        var response = await base.SendAsync(request, cancellationToken);
        if (request.Headers.Contains("x-flarestack-protocol"))
        {
            Internal.Protocol.Ensure(response, "Flarestack.Authentication");
        }

        return response;
    }
}
