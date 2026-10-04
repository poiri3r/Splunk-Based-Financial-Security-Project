package com.club.bank;
import jakarta.persistence.*;
import java.time.Instant;
@Entity @Table(name="setting_actions")
class SettingAction {
    @Id @Column(length=64) String tokenHash;
    @Column(nullable=false) Long userId;
    @Column(nullable=false,length=36) String targetId;
    @Column(nullable=false,length=32) String purpose;
    @Column(nullable=false,length=64) String payloadHash;
    @Column(nullable=false) Instant expiresAt;
    @Column(nullable=false) boolean consumed;
    protected SettingAction(){}
}
