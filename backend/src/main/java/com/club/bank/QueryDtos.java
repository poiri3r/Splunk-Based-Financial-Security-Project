package com.club.bank;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
record AccountDetail(String accountId,String number,String accountName,String accountType,String currency,
    String status,String balance,String availableBalance,Instant openedAt,AccountSettings preferences) {}
record AccountList(List<AccountDetail> items) {}
record OpenedAccount(String accountId,String number,String balance,Instant openedAt) {}
record TransactionDetail(String entryId,String transferId,String counterparty,String amount,String direction,
    String balanceAfter,Instant createdAt) {}
record TransactionPage(List<TransactionDetail> items,String nextCursor,boolean hasNext,LocalDate from,LocalDate to) {}
enum TransactionType {ALL,DEPOSIT,WITHDRAWAL}
