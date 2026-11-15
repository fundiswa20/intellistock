using static IntelliStock.Api.Domain.OrderRules;

namespace IntelliStock.Api.Tests.Unit;

// FR-10: order status rules (D37)
[Trait("Category", "Unit")]
public class OrderRulesTests
{
    [Theory]
    [InlineData("Placed", "Confirmed")]
    [InlineData("Placed", "Declined")]
    [InlineData("Confirmed", "Dispatched")]
    [InlineData("Dispatched", "Delivered")]
    public void A_supplier_moves_an_order_forward_one_step(string from, string to) =>
        Assert.Null(SupplierMoveError(from, to));

    [Theory]
    [InlineData("Placed", "Delivered")]
    [InlineData("Confirmed", "Declined")]
    [InlineData("Dispatched", "Confirmed")]
    [InlineData("Placed", "Cancelled")]
    public void A_supplier_cannot_skip_reverse_or_cancel(string from, string to) =>
        Assert.NotNull(SupplierMoveError(from, to));

    [Theory]
    [InlineData("Delivered")]
    [InlineData("Declined")]
    [InlineData("Cancelled")]
    public void A_closed_order_cannot_change(string status)
    {
        Assert.Empty(SupplierNext(status));
        Assert.Equal($"This order is {status.ToLower()} and can no longer change.", SupplierMoveError(status, "Confirmed"));
    }

    [Theory]
    [InlineData("Placed", true)]
    [InlineData("Confirmed", false)]
    [InlineData("Dispatched", false)]
    public void The_owner_can_cancel_only_before_the_supplier_confirms(string status, bool expected) =>
        Assert.Equal(expected, OwnerCanCancel(status));

    [Fact]
    public void Declined_and_cancelled_orders_give_their_packs_back()
    {
        Assert.True(ReturnsStock("Declined"));
        Assert.True(ReturnsStock("Cancelled"));
        Assert.False(ReturnsStock("Delivered"));
    }

    [Fact]
    public void The_total_is_packs_times_pack_price_plus_the_delivery_fee() =>
        Assert.Equal(3 * 183.84m + 85m, Total(3, 183.84m, 85m));
}
