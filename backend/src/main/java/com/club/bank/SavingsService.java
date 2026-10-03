package com.club.bank;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
import org.springframework.security.crypto.password.PasswordEncoder;
import jakarta.persistence.*;
import com.fasterxml.jackson.databind.*;
import java.util.*;
import java.math.*;
import java.time.*;
import java.time.temporal.ChronoUnit;
import java.security.SecureRandom;
import java.nio.charset.StandardCharsets;

/** Internal demonstration products. No bank integration, scheduler, tax or real interest promise. */
@Service
class SavingsService {
 static final String TERMS="MOCK-SAVINGS-2026-v1";
 private final CurrentCustomer current; private final AccountRepo accounts; private final SavingsContractRepo contracts;
 private final SavingsPaymentRepo payments; private final SavingsReceiptRepo receipts; private final IdempotencyRepo keys;
 private final LedgerRepo ledger; private final AccountPolicy policy; private final PasswordEncoder passwords;
 private final FieldCrypto crypto; private final ObjectMapper json; private final EntityManager em; private final TransferRequestLimiter limiter;
 private static final SecureRandom RANDOM=new SecureRandom();
 SavingsService(CurrentCustomer current,AccountRepo accounts,SavingsContractRepo contracts,SavingsPaymentRepo payments,
 SavingsReceiptRepo receipts,IdempotencyRepo keys,LedgerRepo ledger,AccountPolicy policy,PasswordEncoder passwords,
 FieldCrypto crypto,ObjectMapper json,EntityManager em,TransferRequestLimiter limiter){
 this.current=current;this.accounts=accounts;this.contracts=contracts;this.payments=payments;this.receipts=receipts;this.keys=keys;
 this.ledger=ledger;this.policy=policy;this.passwords=passwords;this.crypto=crypto;this.json=json;this.em=em;this.limiter=limiter;
 }
 record Product(String productId,String name,String accountType,int months,String annualRate,String earlyRate,String minimum,String maximum,String termsVersion,String termsText){}
 List<Product> catalog(){return List.of(
 new Product("MOCK-DEPOSIT-12","모의 정기예금","TERM_DEPOSIT",12,"0.030000","0.010000","10000.00","1000000.00",TERMS,"교육용 모의 상품. 단리·실제 일수/365, 세금 0, 만기 이후 이자 없음. 자동 해지 없음."),
 new Product("MOCK-SAVINGS-12","모의 정기적금","INSTALLMENT_SAVINGS",12,"0.040000","0.010000","1000.00","1000000.00",TERMS,"교육용 모의 상품. 가입일 기준 매월 정액 수동 납입. 월 1회, 누락 회차 소급 납입 불가. 단리·실제 일수/365, 세금 0, 자동이체 없음."));}
 static ApiException conflict(String code){return new ApiException(HttpStatus.CONFLICT,code,"상품 상태 또는 거래 조건을 확인하고 다시 조회해 주세요.");}
 static void checking(Account a){if(!"CHECKING".equals(a.accountType))throw conflict("PRODUCT_ACCOUNT_RESTRICTED");}
 private Account owned(UUID id){return accounts.findByPublicIdAndOwnerId(id.toString(),current.id()).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","계좌를 찾을 수 없습니다."));}
 private SavingsContract contract(UUID id){return contracts.findByIdAndUserId(id.toString(),current.id()).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"SAVINGS_NOT_FOUND","가입 정보를 찾을 수 없습니다."));}
 private void active(SavingsContract c){if(!"ACTIVE".equals(c.status))throw conflict("SAVINGS_CLOSED");}
 private void usable(Account a){if(!"ACTIVE".equals(a.status)||!"KRW".equals(a.currency))throw conflict("ACCOUNT_UNAVAILABLE");}
 private void lock(Account... list){Arrays.stream(list).sorted(Comparator.comparing(a->a.id)).forEach(a->{accounts.findLockedById(a.id).orElseThrow();em.refresh(a,LockModeType.PESSIMISTIC_WRITE);});}
 private void authenticate(BankUser u,String password){limiter.check(u.id,"savings-auth",5,300);if(password.getBytes(StandardCharsets.UTF_8).length>72||!passwords.matches(password,u.passwordHash))throw new ApiException(HttpStatus.UNAUTHORIZED,"REAUTHENTICATION_FAILED","비밀번호가 올바르지 않습니다.");}
 private String encode(Object r){try{return json.writeValueAsString(r);}catch(Exception e){throw new IllegalStateException("상품 응답 처리 실패");}}
 private JsonNode decode(String r){try{return json.readTree(r);}catch(Exception e){throw new IllegalStateException("상품 응답 처리 실패");}}
 private String hash(String op,Object r){return crypto.lookup("savings.request",op+"|"+encode(r));}
 private JsonNode replay(BankUser u,String key,String op,String hash){
 IdempotencyKeys.require(key);
 var old=keys.findByUserIdAndRequestKey(u.id,key).orElse(null);if(old==null)return null;
 if(!old.operation.equals(op)||!old.requestHash.equals(hash))throw conflict("IDEMPOTENCY_KEY_CONFLICT");
 var r=receipts.findById(old.resultId).orElseThrow();return decode(crypto.decrypt("savings.receipt",r.id,r.resultEncrypted));
 }
 private JsonNode finish(BankUser u,String key,String op,String hash,Object result){
 var r=new SavingsReceipt();r.resultEncrypted=crypto.encrypt("savings.receipt",r.id,encode(result));receipts.save(r);
 keys.save(new IdempotencyRecord(u,key,hash,op,r.id));return decode(encode(result));
 }
 private void funding(BankUser u,Account from,BigDecimal amount){checking(from);usable(from);AccountPolicy.debit(from);
 if(from.balance.compareTo(amount)<0)throw conflict("INSUFFICIENT_BALANCE");policy.checkLimits(u,amount);}
 private String move(Account from,Account to,BigDecimal amount){
 if(to.balance.add(amount).compareTo(TransferEngine.MAX_BALANCE)>0)throw conflict("BALANCE_LIMIT_EXCEEDED");
 from.balance=from.balance.subtract(amount);to.balance=to.balance.add(amount);String id=UUID.randomUUID().toString();
 ledger.save(new LedgerEntry(from,to.number(crypto),amount.negate(),id,crypto));ledger.save(new LedgerEntry(to,from.number(crypto),amount,id,crypto));return id;
 }
 private void payment(SavingsContract c,int period,BigDecimal amount,LocalDate day){var p=new SavingsPayment();p.contractId=c.id;p.periodIndex=period;p.amount=amount;p.paidOn=day;payments.save(p);}
 private Map<String,Object> view(SavingsContract c){Account a=accounts.findById(c.accountId).orElseThrow();var v=new LinkedHashMap<String,Object>();
 v.put("subscriptionId",c.id);v.put("productId",c.productId);v.put("accountId",a.publicId);v.put("accountNumber",a.number(crypto));v.put("status",c.status);
 v.put("principal",a.balance.setScale(2).toPlainString());v.put("installment",c.installment.toPlainString());v.put("openedOn",c.openedOn);v.put("maturityOn",c.maturityOn);v.put("closedOn",c.closedOn);v.put("version",c.version);v.put("annualRate",c.annualRate.toPlainString());v.put("earlyRate",c.earlyRate.toPlainString());v.put("termsVersion",c.termsVersion);v.put("simulation",true);
 v.put("payments",payments.findByContractIdOrderByPeriodIndex(c.id).stream().map(p->Map.of("period",p.periodIndex,"paidOn",p.paidOn,"amount",p.amount.toPlainString())).toList());return v;}
 @Transactional(readOnly=true) public Object list(){return Map.of("items",contracts.findByUserIdOrderByAcceptedAtDesc(current.id()).stream().map(this::view).toList());}
 @Transactional(readOnly=true) public Object detail(UUID id){return view(contract(id));}
 @Transactional(noRollbackFor=PinFailure.class) public Object join(String key,SavingsJoin r){
 BankUser u=current.locked();CredentialPolicy.banking(u);String h=hash("SAVINGS_JOIN",r);var old=replay(u,key,"SAVINGS_JOIN",h);if(old!=null)return old;
 Product product=catalog().stream().filter(p->p.productId.equals(r.productId())).findFirst().orElseThrow(()->new ApiException(HttpStatus.BAD_REQUEST,"PRODUCT_NOT_FOUND","상품을 확인해 주세요."));
 if(!TERMS.equals(r.termsVersion()))throw conflict("TERMS_VERSION_MISMATCH");BigDecimal amount=new BigDecimal(r.amount()).setScale(2);
 if(amount.compareTo(new BigDecimal(product.minimum))<0||amount.compareTo(new BigDecimal(product.maximum))>0)throw conflict("PRODUCT_AMOUNT_INVALID");
 Account source=owned(r.sourceAccountId());lock(source);funding(u,source,amount);authenticate(u,r.password());policy.verifyPin(source,r.pin());
 // PIN failure commits only its attempt counter. All financial writes begin below.
 Account holding=new Account("3"+String.format("%015d",RANDOM.nextLong(1000000000000000L)),u,BigDecimal.ZERO.setScale(2),crypto);
 holding.accountName=product.name;holding.accountType=product.accountType;holding.debitEnabled=false;accounts.saveAndFlush(holding);
 var c=new SavingsContract();c.userId=u.id;c.accountId=holding.id;c.productId=product.productId;c.termsVersion=TERMS;c.acceptedAt=Instant.now();c.openedOn=AccountPolicy.today();c.months=product.months;c.maturityOn=c.openedOn.plusMonths(c.months);c.annualRate=new BigDecimal(product.annualRate);c.earlyRate=new BigDecimal(product.earlyRate);c.installment=amount;contracts.save(c);
 policy.consume(u,amount);move(source,holding,amount);payment(c,0,amount,c.openedOn);return finish(u,key,"SAVINGS_JOIN",h,view(c));
 }
 static int period(LocalDate opened,LocalDate day){int p=(day.getYear()-opened.getYear())*12+day.getMonthValue()-opened.getMonthValue();if(day.isBefore(opened.plusMonths(p)))p--;return p;}
 @Transactional(noRollbackFor=PinFailure.class) public Object pay(UUID id,String key,SavingsPay r){
 BankUser u=current.locked();CredentialPolicy.banking(u);String h=hash("SAVINGS_PAY",List.of(id,r));var old=replay(u,key,"SAVINGS_PAY",h);if(old!=null)return old;
 var c=contract(id);active(c);AccountManagementService.version(c.version,r.version());if(!c.productId.equals("MOCK-SAVINGS-12"))throw conflict("PAYMENT_NOT_SUPPORTED");
 LocalDate day=AccountPolicy.today();int period=period(c.openedOn,day);if(period<0||period>=c.months||!day.isBefore(c.maturityOn))throw conflict("PAYMENT_PERIOD_CLOSED");
 if(payments.existsByContractIdAndPeriodIndex(c.id,period))throw conflict("PERIOD_ALREADY_PAID");
 Account source=owned(r.sourceAccountId()),holding=accounts.findById(c.accountId).orElseThrow();lock(source,holding);usable(holding);funding(u,source,c.installment);authenticate(u,r.password());policy.verifyPin(source,r.pin());
 policy.consume(u,c.installment);move(source,holding,c.installment);payment(c,period,c.installment,day);c.version++;return finish(u,key,"SAVINGS_PAY",h,view(c));
 }
 static BigDecimal interest(List<SavingsPayment> rows,LocalDate end,BigDecimal rate){BigDecimal total=BigDecimal.ZERO;for(var p:rows)total=total.add(p.amount.multiply(rate).multiply(BigDecimal.valueOf(Math.max(0,ChronoUnit.DAYS.between(p.paidOn,end)))));return total.divide(BigDecimal.valueOf(365),2,RoundingMode.DOWN);}
 private Map<String,Object> quoteView(SavingsContract c,Account target,LocalDate day){
 active(c);checking(target);usable(target);Account holding=accounts.findById(c.accountId).orElseThrow();usable(holding);
 boolean mature=!day.isBefore(c.maturityOn);BigDecimal interest=interest(payments.findByContractIdOrderByPeriodIndex(c.id),mature?c.maturityOn:day,mature?c.annualRate:c.earlyRate);
 BigDecimal total=holding.balance.add(interest);if(target.balance.add(total).compareTo(TransferEngine.MAX_BALANCE)>0)throw conflict("BALANCE_LIMIT_EXCEEDED");
 var q=new LinkedHashMap<String,Object>();q.put("subscriptionId",c.id);q.put("targetAccountId",target.publicId);q.put("version",c.version);q.put("quoteDate",day);q.put("principal",holding.balance.toPlainString());q.put("interest",interest.toPlainString());q.put("tax","0.00");q.put("total",total.toPlainString());q.put("closureType",mature?"MATURE":"EARLY");q.put("simulation",true);
 q.put("quoteToken",crypto.lookup("savings.quote",c.userId+"|"+encode(q)));return q;
 }
 @Transactional public Object quote(UUID id,UUID target){current.locked();var c=contract(id);Account a=owned(target),h=accounts.findById(c.accountId).orElseThrow();lock(a,h);return quoteView(c,a,AccountPolicy.today());}
 @Transactional public Object close(UUID id,String key,SavingsClose r){
 BankUser u=current.locked();CredentialPolicy.banking(u);String hash=hash("SAVINGS_CLOSE",List.of(id,r));var old=replay(u,key,"SAVINGS_CLOSE",hash);if(old!=null)return old;
 var c=contract(id);active(c);AccountManagementService.version(c.version,r.version());Account target=owned(r.targetAccountId()),holding=accounts.findById(c.accountId).orElseThrow();lock(target,holding);
 LocalDate day=AccountPolicy.today();var q=quoteView(c,target,day);
 if(!day.equals(r.quoteDate())||!java.security.MessageDigest.isEqual(q.get("quoteToken").toString().getBytes(StandardCharsets.UTF_8),r.quoteToken().getBytes(StandardCharsets.UTF_8)))throw conflict("QUOTE_STALE");
 authenticate(u,r.password());BigDecimal principal=holding.balance,interest=new BigDecimal(q.get("interest").toString());move(holding,target,principal);
 if(interest.signum()>0){target.balance=target.balance.add(interest);ledger.save(new LedgerEntry(target,"SIMULATED_SAVINGS_INTEREST",interest,UUID.randomUUID().toString(),crypto));}
 holding.status="CLOSED";holding.securityVersion++;holding.settingsVersion++;c.status="CLOSED";c.closedOn=day;c.version++;
 var result=new LinkedHashMap<String,Object>(q);result.remove("quoteToken");result.put("status","CLOSED");result.put("version",c.version);return finish(u,key,"SAVINGS_CLOSE",hash,result);
 }
}
