USE [MultiBranchPOS];
GO

IF OBJECT_ID(N'dbo.CK_Orders_Status', N'C') IS NOT NULL
    ALTER TABLE dbo.Orders DROP CONSTRAINT CK_Orders_Status;
GO

ALTER TABLE dbo.Orders
ADD CONSTRAINT CK_Orders_Status CHECK (
    Status IN (
        N'Chờ thanh toán',
        N'Chờ xác nhận thanh toán',
        N'Chờ duyệt',
        N'Chờ chế biến',
        N'Đang chế biến',
        N'Bếp hoàn thành',
        N'Chờ Shipper xác nhận',
        N'Đang giao hàng',
        N'Hoàn tất'
    )
);
GO

IF OBJECT_ID(N'dbo.DF_Orders_Status', N'D') IS NOT NULL
    ALTER TABLE dbo.Orders DROP CONSTRAINT DF_Orders_Status;
GO

ALTER TABLE dbo.Orders
ADD CONSTRAINT DF_Orders_Status DEFAULT (N'Chờ thanh toán') FOR Status;
GO
