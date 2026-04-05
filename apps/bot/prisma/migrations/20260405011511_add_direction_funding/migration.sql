-- AlterTable
ALTER TABLE "Grid" ADD COLUMN     "direction" TEXT NOT NULL DEFAULT 'long',
ADD COLUMN     "entryPrice" DOUBLE PRECISION NOT NULL DEFAULT 0,
ADD COLUMN     "fundingPnl" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- AlterTable
ALTER TABLE "PnlSnapshot" ADD COLUMN     "fundingPnl" DOUBLE PRECISION NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE "FundingPayment" (
    "id" TEXT NOT NULL,
    "gridId" TEXT NOT NULL,
    "amount" DOUBLE PRECISION NOT NULL,
    "rate" DOUBLE PRECISION NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "FundingPayment_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "FundingPayment_gridId_timestamp_idx" ON "FundingPayment"("gridId", "timestamp");

-- CreateIndex
CREATE INDEX "GridTrade_gridId_timestamp_idx" ON "GridTrade"("gridId", "timestamp");

-- AddForeignKey
ALTER TABLE "FundingPayment" ADD CONSTRAINT "FundingPayment_gridId_fkey" FOREIGN KEY ("gridId") REFERENCES "Grid"("id") ON DELETE CASCADE ON UPDATE CASCADE;
