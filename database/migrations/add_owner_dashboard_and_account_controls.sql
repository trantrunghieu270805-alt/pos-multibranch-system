USE [MultiBranchPOS];
GO

IF OBJECT_ID(N'dbo.CK_Users_Role', N'C') IS NOT NULL
    ALTER TABLE dbo.Users DROP CONSTRAINT CK_Users_Role;
GO

ALTER TABLE dbo.Users
ADD CONSTRAINT CK_Users_Role CHECK (
    Role IN (N'OWNER', N'CUSTOMER', N'MANAGER', N'CHEF', N'SHIPPER')
);
GO

IF COL_LENGTH(N'dbo.Users', N'IsActive') IS NULL
    ALTER TABLE dbo.Users
    ADD IsActive BIT NOT NULL CONSTRAINT DF_Users_IsActive DEFAULT (1) WITH VALUES;
GO

IF COL_LENGTH(N'dbo.Branches', N'BankID') IS NULL
    ALTER TABLE dbo.Branches ADD BankID NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.Branches', N'AccountNo') IS NULL
    ALTER TABLE dbo.Branches ADD AccountNo NVARCHAR(50) NULL;
GO

IF COL_LENGTH(N'dbo.Branches', N'AccountName') IS NULL
    ALTER TABLE dbo.Branches ADD AccountName NVARCHAR(120) NULL;
GO

IF COL_LENGTH(N'dbo.Orders', N'PaymentMethod') IS NULL
    ALTER TABLE dbo.Orders ADD PaymentMethod NVARCHAR(20) NULL;
GO

IF OBJECT_ID(N'dbo.CK_Orders_PaymentMethod', N'C') IS NULL
    ALTER TABLE dbo.Orders
    ADD CONSTRAINT CK_Orders_PaymentMethod CHECK (
        PaymentMethod IS NULL OR PaymentMethod IN (N'CASH', N'VIETQR')
    );
GO

UPDATE dbo.Orders
SET PaymentMethod = N'VIETQR'
WHERE PaymentMethod IS NULL AND TableID IS NULL AND CustomerID IS NOT NULL;
GO

IF NOT EXISTS (SELECT 1 FROM dbo.Users WHERE Username = N'owner.demo')
BEGIN
    INSERT INTO dbo.Users (FullName, Username, PasswordHash, Role, Phone)
    VALUES (
        N'Chủ doanh nghiệp',
        N'owner.demo',
        N'$2b$10$VsTNb/iNt/9EG2VvCoXI3OqCujWZpWRzFOwm9tXyyUIJQZnlZxsfK',
        N'OWNER',
        N'0900000005'
    );
END;
GO
