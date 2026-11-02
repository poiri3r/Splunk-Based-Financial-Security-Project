FROM alpine:3.22 AS directories
RUN mkdir -p /data/state /data/buffer /data/collected \
    && chown -R 10001:10001 /data \
    && chmod 700 /data

FROM fluent/fluent-bit:5.1.5
COPY --from=directories --chown=10001:10001 /data /data
COPY fluent-bit.conf parsers.conf /fluent-bit/etc/
USER 10001:10001
ENTRYPOINT ["/fluent-bit/bin/fluent-bit", "-c", "/fluent-bit/etc/fluent-bit.conf"]
