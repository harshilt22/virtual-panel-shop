ELECTRICAL VIRTUAL SHOP - SHOPPING BUILDER UPDATE
=================================================

Run:
1. Double-click START VIRTUAL SHOP.bat
2. Open http://localhost:3500
3. Other shop computers use http://SERVER-IP:3500

IMPORTANT WHEN UPDATING AN EXISTING INSTALLATION
------------------------------------------------
Your real shared data is stored in shop-data.json.
DO NOT overwrite your existing shop-data.json if it already contains your shop information.

Safest update:
- Stop the old server.
- Back up the old shop-data.json.
- Copy the NEW index.html and server.js into your existing Virtual Shop folder.
- Keep your existing shop-data.json.
- Start the server again.

This server automatically upgrades older shop-data.json files that are missing the settings section.

NEW QUOTE / BOM EXPERIENCE
--------------------------
- Quote Builder works like an online shopping cart.
- BOM Builder works like an online shopping cart.
- Shop Inventory tab shows available stock quantity and shelf/location.
- Digital Library tab lets Estimator/Designer add products not currently in shop stock.
- BOM cart shows stock available and quantity that may need ordering.
- Same Job Number follows Quote -> BOM -> Ordering -> Receiving.
- Quote can transfer to BOM.
- Approved BOM can transfer to Ordering.

DIGITAL LIBRARY
---------------
- Import old Excel BOM sheets.
- Products match by Part Number.
- Existing description conflicts can keep old, use new, keep both, or skip.

REV 02 - ESTIMATOR QUOTE BUILDER UPDATE
- New Quote opens directly into shopping-style Quote Builder.
- Search products by description, maker, part number, or previous job number.
- Search both Shop Inventory and Digital Library.
- Shows shop stock, location, price, and previous jobs where a product was used.
- Quote cart includes quantity, unit price, extended price, and material total.
- Job Awarded button transfers the saved Quote to an Open BOM with the same Job Number.


REV 06 WORKFLOW: Estimator and Designer use Digital Library only. Buyer checks shop inventory after BOM approval and reduces only Remaining to Order, never the BOM quantity.
