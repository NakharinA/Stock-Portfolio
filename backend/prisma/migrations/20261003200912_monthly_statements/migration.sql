-- CreateTable
CREATE TABLE "monthly_statements" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "asOf" DATE NOT NULL,
    "totalBalance" DECIMAL(20,4) NOT NULL,
    "cashBalance" DECIMAL(20,4) NOT NULL,
    "dividendsSinceStart" DECIMAL(20,4) NOT NULL DEFAULT 0,
    "holdings" JSONB NOT NULL DEFAULT '{}',
    "gmailMessageId" TEXT NOT NULL,
    "filename" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "monthly_statements_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "monthly_statements_userId_asOf_key" ON "monthly_statements"("userId", "asOf");

-- AddForeignKey
ALTER TABLE "monthly_statements" ADD CONSTRAINT "monthly_statements_userId_fkey" FOREIGN KEY ("userId") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;
