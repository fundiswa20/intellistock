using System.Globalization;
using System.Net;
using System.Text;

namespace IntelliStock.Api.Services;

// D40: the one email layout - an IntelliStock header in the brand green, a short message,
// the order details as a table, and a plain-text version of the same. Inline styles only:
// no images, no external CSS.
public static class EmailTemplate
{
    private const string Green = "#18614a";      // --green-700, the client's primary
    private const string DarkGreen = "#0e3527";  // --green-900, the sidebar

    public static (string Html, string Text) Render(string heading, string intro, IEnumerable<(string Label, string Value)> rows,
                                                    string? footer = null)
    {
        var details = rows.Where(r => !string.IsNullOrWhiteSpace(r.Value)).ToList();
        var e = (string s) => WebUtility.HtmlEncode(s);

        var html = new StringBuilder();
        html.Append("<!doctype html><html><body style=\"margin:0;padding:0;background:#f2f6f4;\">");
        html.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"background:#f2f6f4;padding:24px 0;\"><tr><td align=\"center\">");
        html.Append("<table role=\"presentation\" width=\"560\" cellpadding=\"0\" cellspacing=\"0\" style=\"max-width:560px;width:100%;background:#ffffff;border-radius:8px;overflow:hidden;font-family:Arial,Helvetica,sans-serif;color:#151d24;\">");
        html.Append($"<tr><td style=\"background:{DarkGreen};padding:18px 24px;\">");
        html.Append($"<span style=\"display:inline-block;background:{Green};color:#ffffff;font-weight:bold;font-size:12px;padding:6px 8px;border-radius:6px;\">IS</span>");
        html.Append("<span style=\"color:#ffffff;font-weight:bold;font-size:18px;padding-left:10px;vertical-align:middle;\">IntelliStock</span></td></tr>");
        html.Append("<tr><td style=\"padding:24px;\">");
        html.Append($"<h1 style=\"margin:0 0 8px;font-size:20px;color:{DarkGreen};\">{e(heading)}</h1>");
        html.Append($"<p style=\"margin:0 0 20px;font-size:14px;line-height:1.5;color:#3b4753;\">{e(intro)}</p>");
        html.Append("<table role=\"presentation\" width=\"100%\" cellpadding=\"0\" cellspacing=\"0\" style=\"border-collapse:collapse;font-size:14px;\">");
        foreach (var (label, value) in details)
            html.Append("<tr>")
                .Append($"<td style=\"padding:8px 0;border-bottom:1px solid #e2e7eb;color:#586572;width:40%;\">{e(label)}</td>")
                .Append($"<td style=\"padding:8px 0;border-bottom:1px solid #e2e7eb;font-weight:bold;\">{e(value)}</td>")
                .Append("</tr>");
        html.Append("</table>");
        if (footer is not null)
            html.Append($"<p style=\"margin:20px 0 0;font-size:13px;line-height:1.5;color:#586572;\">{e(footer)}</p>");
        html.Append("</td></tr>");
        html.Append("<tr><td style=\"padding:14px 24px;background:#f7f9fa;font-size:12px;color:#76828e;\">Sent by IntelliStock about an order on your account.</td></tr>");
        html.Append("</table></td></tr></table></body></html>");

        var text = new StringBuilder();
        text.AppendLine("IntelliStock").AppendLine().AppendLine(heading).AppendLine().AppendLine(intro).AppendLine();
        var width = details.Count == 0 ? 0 : details.Max(d => d.Label.Length);
        foreach (var (label, value) in details) text.AppendLine($"{(label + ":").PadRight(width + 2)}{value}");
        if (footer is not null) text.AppendLine().AppendLine(footer);
        text.AppendLine().AppendLine("Sent by IntelliStock about an order on your account.");

        return (html.ToString(), text.ToString());
    }

    public static string Money(decimal n) => "R " + n.ToString("#,##0.00", CultureInfo.InvariantCulture);
    public static string Date(DateTime d) => d.ToString("ddd d MMM yyyy", CultureInfo.InvariantCulture);
}
