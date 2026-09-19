using System.Reflection;
namespace Flarestack.Internal;
internal static class Protocol
{
    internal const string Version = "2";
    internal static string Release => typeof(Protocol).Assembly.GetCustomAttribute<AssemblyInformationalVersionAttribute>()!.InformationalVersion.Split('+')[0];
    internal static void Configure(HttpClient client) {
        client.DefaultRequestHeaders.Add("x-flarestack-protocol", Version);
        client.DefaultRequestHeaders.Add("x-flarestack-release", Release);
    }
    internal static void Ensure(HttpResponseMessage response, string package) {
        var actual = response.Headers.TryGetValues("x-flarestack-protocol", out var values) ? values.FirstOrDefault() : "missing";
        if (actual != Version) throw new ProtocolMismatchException($"{package} {Release} expects protocol {Version}, but the Worker exposes protocol {actual}. Upgrade the complete Flarestack package set together.");
    }
}
internal sealed class ProtocolMismatchException(string message) : Exception(message);
