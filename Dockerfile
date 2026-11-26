FROM maven:3.9.16-eclipse-temurin-17 AS build
WORKDIR /workspace
COPY pom.xml ./
RUN mvn -B -ntp dependency:go-offline
COPY src ./src
RUN mvn -B -ntp clean package

FROM tomcat:9.0.123-jdk17-temurin-noble
RUN rm -rf "${CATALINA_HOME}/webapps"/*
COPY --from=build /workspace/target/gis-scan-1.0.0.war ${CATALINA_HOME}/webapps/ROOT.war
EXPOSE 8080
CMD ["catalina.sh", "run"]

