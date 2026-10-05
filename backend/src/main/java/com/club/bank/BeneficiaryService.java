package com.club.bank;
import java.time.Instant;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;
import org.springframework.http.HttpStatus;
@Service
class BeneficiaryService {
    private final CurrentCustomer current;private final UserRepo users;private final BeneficiaryRepo repo;
    private final AccountRepo accounts;private final FieldCrypto crypto;private final TransferRequestLimiter limiter;
    BeneficiaryService(CurrentCustomer current,UserRepo users,BeneficiaryRepo repo,AccountRepo accounts,FieldCrypto crypto,TransferRequestLimiter limiter){
        this.current=current;this.users=users;this.repo=repo;this.accounts=accounts;this.crypto=crypto;this.limiter=limiter;}
    private void lock(){current.locked();}
    private Beneficiary owned(UUID id){return repo.findByIdAndUserId(id.toString(),current.id()).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"BENEFICIARY_NOT_FOUND","등록 계좌가 없거나 접근할 수 없습니다."));}
    private BeneficiaryView view(Beneficiary b){return new BeneficiaryView(b.id,b.bankCode,crypto.decrypt("beneficiaries.number",b.id,b.numberEncrypted),
        b.aliasEncrypted==null?null:crypto.decrypt("beneficiaries.alias",b.id,b.aliasEncrypted),b.createdAt,b.version);}
    @Transactional(readOnly=true) public BeneficiaryList list(){return new BeneficiaryList(repo.findByUserIdOrderByCreatedAtAscIdAsc(current.id()).stream().map(this::view).toList());}
    @Transactional public BeneficiaryView add(BeneficiaryRequest r){
        limiter.check(current.id(),"receiver",30,60);lock();String lookup=crypto.lookup("beneficiaries.number",current.id()+":"+r.accountNumber());
        if(repo.existsByUserIdAndBankCodeAndNumberLookup(current.id(),r.bankCode(),lookup))throw new ApiException(HttpStatus.CONFLICT,"BENEFICIARY_EXISTS","이미 등록한 계좌입니다.");
        if(repo.countByUserId(current.id())>=100)throw new ApiException(HttpStatus.CONFLICT,"BENEFICIARY_LIMIT","최대 100개까지 등록할 수 있습니다.");
        Account a=accounts.findByNumberLookup(crypto.lookup("accounts.number",r.accountNumber())).orElseThrow(()->new ApiException(HttpStatus.NOT_FOUND,"ACCOUNT_NOT_FOUND","수취 계좌를 확인해 주세요."));
        if(!"ACTIVE".equals(a.status)||!"KRW".equals(a.currency))throw new ApiException(HttpStatus.CONFLICT,"ACCOUNT_UNAVAILABLE","수취할 수 없는 계좌입니다.");
        Beneficiary b=new Beneficiary();b.id=UUID.randomUUID().toString();b.userId=current.id();b.bankCode=r.bankCode();b.numberLookup=lookup;
        b.numberEncrypted=crypto.encrypt("beneficiaries.number",b.id,r.accountNumber());setAlias(b,r.alias());
        b.createdAt=Instant.now().truncatedTo(java.time.temporal.ChronoUnit.MICROS);return view(repo.save(b));
    }
    private void setAlias(Beneficiary b,String raw){String value=AccountManagementService.alias(raw);b.aliasEncrypted=value==null?null:crypto.encrypt("beneficiaries.alias",b.id,value);}
    @Transactional public BeneficiaryView update(UUID id,BeneficiaryAliasRequest r){lock();Beneficiary b=owned(id);AccountManagementService.version(b.version,r.version());setAlias(b,r.alias());b.version++;return view(b);}
    @Transactional public void delete(UUID id,long version){lock();Beneficiary b=owned(id);AccountManagementService.version(b.version,version);repo.delete(b);}
}
