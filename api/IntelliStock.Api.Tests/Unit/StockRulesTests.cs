using IntelliStock.Api.Domain;
using static IntelliStock.Api.Domain.StockRules;

namespace IntelliStock.Api.Tests.Unit;

[Trait("Category", "Unit")]
public class StockRulesTests
{
    // FR-04: movement rules

    [Fact]
    public void Sale_reduces_stock_by_the_quantity_sold() =>
        Assert.Equal((-3, (string?)null), SignedChange("Sale", 3, 10));

    [Fact]
    public void Sale_of_the_whole_shelf_is_allowed() =>
        Assert.Equal((-10, (string?)null), SignedChange("Sale", 10, 10));

    [Fact]
    public void Sale_of_more_than_is_on_hand_is_rejected()
    {
        var (_, error) = SignedChange("Sale", 11, 10);
        Assert.Equal("Cannot sell 11 - only 10 in stock.", error);
    }

    [Theory]
    [InlineData("Sale", 0)]
    [InlineData("Sale", -2)]
    [InlineData("Restock", 0)]
    [InlineData("Restock", -5)]
    [InlineData("Adjustment", 0)]
    public void Zero_or_wrong_sign_quantities_are_rejected(string type, int quantity) =>
        Assert.NotNull(SignedChange(type, quantity, 10).Error);

    [Fact]
    public void Restock_adds_the_quantity_received() =>
        Assert.Equal((24, (string?)null), SignedChange("Restock", 24, 3));

    [Fact]
    public void Adjustment_can_correct_in_either_direction()
    {
        Assert.Equal((-2, (string?)null), SignedChange("Adjustment", -2, 10));
        Assert.Equal((5, (string?)null), SignedChange("Adjustment", 5, 10));
    }

    [Fact]
    public void Adjustment_cannot_take_stock_below_zero() =>
        Assert.NotNull(SignedChange("Adjustment", -11, 10).Error);

    [Fact]
    public void Unknown_movement_type_is_rejected() =>
        Assert.Contains("Unknown movement type", SignedChange("Refund", 1, 10).Error);

    // FR-05: alert rules

    [Theory]
    [InlineData(5, 5, false, AlertAction.Raise)]     // at the reorder level
    [InlineData(2, 5, false, AlertAction.Raise)]     // below it
    [InlineData(2, 5, true, AlertAction.None)]       // already alerted: no duplicate
    [InlineData(6, 5, true, AlertAction.Resolve)]    // back above: resolve
    [InlineData(6, 5, false, AlertAction.None)]      // fine, nothing open
    [InlineData(0, 0, false, AlertAction.Raise)]     // empty shelf with reorder level 0
    public void Alert_is_raised_at_or_below_the_reorder_level_and_resolved_above_it(
        int onHand, int level, bool open, AlertAction expected) =>
        Assert.Equal(expected, AlertDecision(onHand, level, open));

    [Fact]
    public void Alert_message_uses_the_right_plural()
    {
        Assert.Equal("Albany Brown Bread 700g is down to 3 loaves (reorder level 6)",
            AlertMessage("Albany Brown Bread 700g", "loaf", 3, 6));
        Assert.Equal("Large Eggs 6-pack is down to 1 box (reorder level 6)",
            AlertMessage("Large Eggs 6-pack", "box", 1, 6));
        Assert.Equal("Tastic Rice 2kg is down to 2 bags (reorder level 3)",
            AlertMessage("Tastic Rice 2kg", "bag", 2, 3));
    }

    [Fact]
    public void Only_categories_the_model_knows_are_accepted() =>
        Assert.Equal(["Clothing", "Electronics", "Furniture", "Groceries", "Toys"], Categories);
}
