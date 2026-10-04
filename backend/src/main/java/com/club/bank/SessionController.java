package com.club.bank;
import org.springframework.web.bind.annotation.*;
import java.util.Map;
@RestController @RequestMapping("/api/v2/auth/session") class SessionController {
 private final SessionService service;
 SessionController(SessionService service){this.service=service;}
 @GetMapping Map<String,Object> status(@RequestHeader("Authorization") String auth){return service.status(auth.substring(7));}
 @PostMapping("/extend") Map<String,Object> extend(@RequestHeader("Authorization") String auth){return service.status(auth.substring(7));}
}
