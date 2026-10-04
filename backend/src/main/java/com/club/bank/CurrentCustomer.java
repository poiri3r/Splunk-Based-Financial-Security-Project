package com.club.bank;
import org.springframework.stereotype.Component;
import org.springframework.security.core.context.SecurityContextHolder;
import org.springframework.http.HttpStatus;
/** Never accept the customer identifier from a request body. */
@Component
class CurrentCustomer {
    private final UserRepo users;private final jakarta.persistence.EntityManager em;
    CurrentCustomer(UserRepo users,jakarta.persistence.EntityManager em) {this.users=users;this.em=em;}
    Long id() {
        var a=SecurityContextHolder.getContext().getAuthentication();
        if(a==null || !(a.getPrincipal() instanceof Long id)) throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","로그인이 필요합니다.");
        return id;
    }
    void requireFresh(BankUser u){
        var a=SecurityContextHolder.getContext().getAuthentication();
        if(!u.getId().equals(id()) || !(a.getCredentials() instanceof Long version) || version!=u.getAuthVersion())
            throw new ApiException(HttpStatus.UNAUTHORIZED,"UNAUTHORIZED","다시 로그인해 주세요.");
    }
    BankUser get(){BankUser u=(BankUser)org.hibernate.Hibernate.unproxy(users.findById(id()).orElseThrow());requireFresh(u);return u;}
    BankUser locked(){BankUser u=users.findLockedById(id()).orElseThrow();em.refresh(u,jakarta.persistence.LockModeType.PESSIMISTIC_WRITE);requireFresh(u);return u;}
}
