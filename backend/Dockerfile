# Dockerfile: 소스 코드를 실행 가능한 컨테이너 이미지로 만드는 절차.
# 첫 단계: Maven으로 실행 가능한 jar 생성
# 빌드용 이미지: Java 17과 Maven이 들어 있다. AS build는 이 단계의 이름이다.
FROM maven:3.9-eclipse-temurin-17 AS build
# 컨테이너 안에서 이후 명령이 실행될 작업 경로를 지정한다.
WORKDIR /app
# 라이브러리·빌드 설정을 컨테이너로 복사한다.
COPY pom.xml .
# 소스 코드와 설정, DB 마이그레이션을 복사한다.
COPY src src
# 실행 JAR를 만든다. -q는 출력 축소, -DskipTests는 테스트 실행 생략.
RUN mvn -q -DskipTests package
# 두 번째 단계: 실행에 필요한 Java만 포함한 이미지
# 실행용 이미지: 빌드 도구 없이 Java 실행 환경만 사용한다.
FROM eclipse-temurin:17-jre
# 컨테이너 안에서 이후 명령이 실행될 작업 경로를 지정한다.
WORKDIR /app
# 앞 단계에서 만든 JAR만 실행 이미지로 가져온다.
COPY --from=build /app/target/bank-backend-0.1.0.jar app.jar
# 관리자(root) 대신 숫자 UID 10001 사용자로 실행한다.
USER 10001
# 컨테이너가 사용할 포트를 알리는 메타데이터. EC2 방화벽 개방이나 포트 공개를 자동으로 하지는 않는다.
EXPOSE 8080
# 컨테이너 시작 시 Java로 app.jar를 실행한다. DB 정보와 프로필은 배포 시 환경변수로 전달한다.
ENTRYPOINT ["java","-jar","/app/app.jar"]
