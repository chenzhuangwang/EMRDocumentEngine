package com.emr.util;

/**
 * Utility to generate BCrypt password hash.
 * Usage: compile with spring-security on classpath, then run
 */
public class BCryptHashGenerator {
    public static void main(String[] args) {
        String password = args.length > 0 ? args[0] : "admin123";
        // Spring Security's BCryptPasswordEncoder with strength 10
        String hash = new org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder(10).encode(password);
        System.out.println("Password: " + password);
        System.out.println("BCrypt Hash: " + hash);
    }
}
