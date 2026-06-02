const cashuSatsFormatter = new Intl.NumberFormat("de-DE", {maximumFractionDigits: 0})

export const formatCashuSats = (amount: number) => cashuSatsFormatter.format(amount || 0)
