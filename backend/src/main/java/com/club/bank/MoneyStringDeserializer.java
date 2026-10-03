package com.club.bank;
import com.fasterxml.jackson.core.*;
import com.fasterxml.jackson.databind.*;
import com.fasterxml.jackson.databind.deser.std.StdDeserializer;
import java.io.IOException;
/** Avoid implicit JSON number -> String coercion in the v2 monetary contract. */
class MoneyStringDeserializer extends StdDeserializer<String> {
    MoneyStringDeserializer(){super(String.class);}
    @Override public String deserialize(JsonParser p,DeserializationContext c)throws IOException {
        if(!p.hasToken(JsonToken.VALUE_STRING))return (String)c.handleUnexpectedToken(String.class,p);
        return p.getText();
    }
}
