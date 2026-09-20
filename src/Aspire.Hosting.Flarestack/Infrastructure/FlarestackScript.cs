using System.Text.RegularExpressions;

namespace Aspire.Hosting.Flarestack.Infrastructure;

internal static class FlarestackScript
{
    internal static string[] Parse(string name, string text)
    {
        // Launch the declared command directly so Aspire owns its signals/PID.
        // Compound shell scripts would obscure lifecycle ownership.
        if (text.IndexOfAny([';', '|', '&', '$', '`', '\n', '\r']) >= 0)
        {
            throw new InvalidOperationException($"{name} must be one executable command, without shell operators.");
        }

        return Regex.Matches(text, "\"([^\"]*)\"|'([^']*)'|([^\\s]+)")
            .Select(match =>
                match.Groups[1].Success ? match.Groups[1].Value :
                match.Groups[2].Success ? match.Groups[2].Value : match.Groups[3].Value).ToArray();
    }
}
