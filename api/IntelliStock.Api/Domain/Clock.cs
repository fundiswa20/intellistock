namespace IntelliStock.Api.Domain;

// Stock movements are recorded in South African time, as the owner experiences them.
// South Africa is UTC+2 all year with no daylight saving, so a fixed offset is exact and
// avoids depending on time-zone data being installed in the container.
public static class Clock
{
    // Kind Unspecified: this is local SA wall-clock time, and must not serialise with a "Z"
    public static DateTime Now => DateTime.SpecifyKind(DateTime.UtcNow.AddHours(2), DateTimeKind.Unspecified);
    public static DateOnly Today => DateOnly.FromDateTime(Now);
}
