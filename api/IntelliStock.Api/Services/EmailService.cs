using System.Net.Mail;
using System.Net.Mime;

namespace IntelliStock.Api.Services;

public record EmailMessage(string To, string Subject, string Html, string Text);

// D40: sends one email. The SMTP implementation is the only one; a hosted provider could be
// another implementation registered in its place.
public interface IEmailService
{
    Task SendAsync(EmailMessage message, CancellationToken ct = default);
}

public class EmailOptions
{
    public const string Section = "Email";
    public string Host { get; set; } = "localhost";
    public int Port { get; set; } = 1025;
    public string From { get; set; } = "IntelliStock <notifications@intellistock.local>";
    public bool EnableSsl { get; set; }
    public string? UserName { get; set; }
    public string? Password { get; set; }
    public int TimeoutSeconds { get; set; } = 5;
}

// Plain SMTP. In development this is MailHog (no authentication); credentials and TLS are
// only used when configured.
public class SmtpEmailService(EmailOptions options) : IEmailService
{
    public async Task SendAsync(EmailMessage message, CancellationToken ct = default)
    {
        using var mail = new MailMessage { From = new MailAddress(options.From), Subject = message.Subject };
        mail.To.Add(message.To);
        // plain text first, HTML last: mail clients show the last part they can render
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.Text, null, MediaTypeNames.Text.Plain));
        mail.AlternateViews.Add(AlternateView.CreateAlternateViewFromString(message.Html, null, MediaTypeNames.Text.Html));

        using var smtp = new SmtpClient(options.Host, options.Port)
        {
            EnableSsl = options.EnableSsl,
            Timeout = options.TimeoutSeconds * 1000,
        };
        if (!string.IsNullOrEmpty(options.UserName))
            smtp.Credentials = new System.Net.NetworkCredential(options.UserName, options.Password);
        await smtp.SendMailAsync(mail, ct);
    }
}
